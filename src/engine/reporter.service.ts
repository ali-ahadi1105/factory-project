import { Injectable, Logger } from '@nestjs/common';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FactoryStoreService } from '../store';
import { LineageService } from './lineage.service';
import {
  Work,
  Execution,
  Actor,
  Signal,
  WorkStatus,
  WorkType,
  WorkPriority,
  ExecutionStatus,
  RelationType,
  CanonicalUri,
  LineageGraph,
} from '../core';

export interface ReporterOptions {
  workId?: string;
  title?: string;
  /** When true, report generators produce the formal manager-ready report. */
  manager?: boolean;
  /** Explicit report number; auto-generated when omitted. */
  reportNumber?: string;
  /** Name of the preparing entity shown on the report header. */
  preparedBy?: string;
  /** Inclusive start of the coverage window (ISO date string). */
  coverageFrom?: string;
  /** Inclusive end of the coverage window (ISO date string). */
  coverageTo?: string;
}

/**
 * A single deliverable row in the executive report.
 */
export interface ExecutiveWorkItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  workType: string;
  leadActor: string;
  issueUrl?: string;
  issueNumber?: number;
  prUrl?: string;
  prNumber?: number;
  branchName?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Performance breakdown for a single actor (human or agent).
 */
export interface ExecutiveActorPerformance {
  actorId: string;
  name: string;
  role: string;
  roleLabel: string;
  type: string;
  availability: string;
  autonomyLevel: string;
  totalExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  successRate: number;
  assignedWorks: number;
}

/**
 * A verification / quality gate summarized for leadership.
 */
export interface ExecutiveQualityGate {
  id: string;
  name: string;
  total: number;
  passed: number;
  failed: number;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

/**
 * A risk or bottleneck surfaced to leadership.
 */
export interface ExecutiveRisk {
  id: string;
  title: string;
  severity: 'low' | 'medium' | 'high';
  impact: string;
  mitigation: string;
}

/**
 * Aggregated executive dataset backing both the report and the web dashboard.
 */
export interface ExecutiveData {
  generatedAt: string;
  gregorianDate: string;
  shamsiDate: string;
  gregorianDateTime: string;
  shamsiDateTime: string;
  reportNumber: string;
  preparedBy: string;
  coverageWindow: {
    from: string;
    to: string;
    fromShamsi: string;
    toShamsi: string;
    label: string;
  };
  status: string;
  automationRate: number;
  metrics: FactorySummaryMetrics;
  works: ExecutiveWorkItem[];
  actors: ExecutiveActorPerformance[];
  qualityGates: ExecutiveQualityGate[];
  risks: ExecutiveRisk[];
  nextActions: string[];
  pendingApprovals: ExecutiveWorkItem[];
  lineageMermaid: string;
}

export interface FactorySummaryMetrics {
  totalWorks: number;
  completedWorks: number;
  pendingWorks: number;
  inProgressWorks: number;
  failedWorks: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  totalActors: number;
  totalSignals: number;
}

@Injectable()
export class ReporterService {
  private readonly logger = new Logger(ReporterService.name);
  private readonly sseClients = new Set<http.ServerResponse>();

  constructor(
    private readonly store: FactoryStoreService,
    private readonly lineageService: LineageService,
  ) {}

  /**
   * Broadcast an arbitrary Server-Sent Event (SSE) to all connected dashboard clients
   */
  broadcastEvent(event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        if (!client.writableEnded) {
          client.write(payload);
        }
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  /**
   * Broadcast a log line from an actor or subsystem to live dashboard
   */
  broadcastLog(actor: string, message: string, level = 'info'): void {
    this.broadcastEvent('log', {
      timestamp: new Date().toISOString(),
      actor,
      message,
      level,
    });
  }

  /**
   * Broadcast a pipeline progress update to live dashboard
   */
  broadcastProgress(step: string, status: string, detail?: string): void {
    this.broadcastEvent('progress', {
      timestamp: new Date().toISOString(),
      step,
      status,
      detail,
    });
  }

  /**
   * Get current count of active SSE client connections
   */
  getActiveSseClientCount(): number {
    return this.sseClients.size;
  }

  /**
   * Calculate high-level factory metrics
   */
  getSummaryMetrics(): FactorySummaryMetrics {
    const works = this.store.listWorks();
    const actors = this.store.listActors();
    const references = this.store.listReferences();

    let completedWorks = 0;
    let pendingWorks = 0;
    let inProgressWorks = 0;
    let failedWorks = 0;

    for (const w of works) {
      if (w.status === WorkStatus.COMPLETED) completedWorks++;
      else if (w.status === WorkStatus.PENDING) pendingWorks++;
      else if (w.status === WorkStatus.IN_PROGRESS) inProgressWorks++;
      else if (w.status === WorkStatus.FAILED) failedWorks++;
    }

    let totalExecutions = 0;
    let successfulExecutions = 0;
    let failedExecutions = 0;

    for (const w of works) {
      const execs = this.store.listExecutionsForWork(w.id);
      totalExecutions += execs.length;
      for (const ex of execs) {
        if (ex.status === ExecutionStatus.COMPLETED) successfulExecutions++;
        else if (ex.status === ExecutionStatus.FAILED) failedExecutions++;
      }
    }

    const successRate =
      totalExecutions > 0
        ? Math.round((successfulExecutions / totalExecutions) * 100)
        : 100;

    const signalRefs = references.filter((r) => r.scheme === 'signal');

    return {
      totalWorks: works.length,
      completedWorks,
      pendingWorks,
      inProgressWorks,
      failedWorks,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      successRate,
      totalActors: actors.length,
      totalSignals: signalRefs.length,
    };
  }

  /**
   * Convert lineage relations to a Mermaid graph string
   */
  toMermaidGraph(rootRef?: string): string {
    const relations = this.store.getAllRelations();
    if (!relations.length) {
      return 'graph TD\n    A[No relations recorded]';
    }

    const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9_]/g, '_');
    const label = (ref: string) => {
      if (ref.startsWith('factory://work/')) {
        return `Work: ${ref.replace('factory://work/', '').slice(0, 8)}...`;
      }
      if (ref.startsWith('agent://')) {
        return `Agent: ${ref.replace('agent://', '')}`;
      }
      if (ref.startsWith('github://pr/')) {
        return `PR: ${ref.replace('github://pr/', '')}`;
      }
      if (ref.startsWith('signal://')) {
        return `Signal: ${ref.replace('signal://', '').slice(0, 10)}...`;
      }
      return ref;
    };

    const lines: string[] = ['graph TD'];
    const filtered = rootRef
      ? relations.filter(
          (r) => r.sourceRef.includes(rootRef) || r.targetRef.includes(rootRef),
        )
      : relations;

    if (!filtered.length && rootRef) {
      return `graph TD\n    Root["${label(rootRef)}"]`;
    }

    for (const rel of filtered) {
      const fromId = sanitize(rel.sourceRef);
      const toId = sanitize(rel.targetRef);
      const fromLabel = label(rel.sourceRef);
      const toLabel = label(rel.targetRef);
      lines.push(`    ${fromId}["${fromLabel}"] -->|${rel.relationType}| ${toId}["${toLabel}"]`);
    }

    return lines.join('\n');
  }

  /**
   * Generate a comprehensive Markdown report
   */
  generateMarkdownReport(options?: ReporterOptions): string {
    const timestamp = new Date().toISOString();
    const metrics = this.getSummaryMetrics();
    const works = this.store.listWorks();
    const actors = this.store.listActors();

    if (options?.workId) {
      const work = this.store.getWork(options.workId);
      if (!work) {
        return `# Software Factory Report - Work Not Found\n\nWork ID \`${options.workId}\` does not exist in the store.\n`;
      }
      const executions = this.store.listExecutionsForWork(work.id);
      const workUri = CanonicalUri.factoryWork(work.id);
      const asciiTree = this.lineageService.formatAsciiTree(workUri);
      const mermaidGraph = this.toMermaidGraph(work.id);

      return `# Software Factory Lineage Report: ${work.title}

- **Work ID:** \`${work.id}\`
- **Status:** \`${work.status}\`
- **Priority:** \`${work.priority}\`
- **Type:** \`${work.type}\`
- **Assigned Actor:** \`${work.assignedActorId || 'None'}\`
- **Created At:** ${work.createdAt}
- **Updated At:** ${work.updatedAt}
- **Report Generated:** ${timestamp}

## Description
${work.description || '(No description provided)'}

## Executions (${executions.length})
${
  executions.length === 0
    ? '_No executions recorded yet._'
    : executions
        .map(
          (ex, idx) => `
### Execution #${idx + 1} (${ex.id})
- **Actor:** \`${ex.actorId}\`
- **Status:** \`${ex.status}\`
- **Correlation ID:** \`${ex.correlationId}\`
- **Started:** ${ex.startedAt}
- **Finished:** ${ex.finishedAt || 'In progress'}
- **Produced References:** ${
            ex.producedReferences.length
              ? ex.producedReferences.map((r) => `\`${r}\``).join(', ')
              : 'None'
          }

${ex.error ? `> ❌ **Error:** ${ex.error}` : ''}

\`\`\`text
${(ex.logs || 'No logs captured').slice(-1500)}
\`\`\`
`,
        )
        .join('\n')
}

## Lineage ASCII Tree
\`\`\`text
${asciiTree}
\`\`\`

## Lineage Relations Graph (Mermaid)
\`\`\`mermaid
${mermaidGraph}
\`\`\`
`;
    }

    // Full Factory Report
    const mermaidGraph = this.toMermaidGraph();

    return `# 🏭 Software Factory Status & Lineage Report

**Generated:** ${timestamp}  
**Architecture:** System of Coordination (Concept v31)

---

## 1. Overview KPIs
| Metric | Value | Status |
| :--- | :--- | :--- |
| **Total Works** | ${metrics.totalWorks} | 📋 |
| **Completed Works** | ${metrics.completedWorks} | ✅ |
| **In Progress / Pending** | ${metrics.inProgressWorks + metrics.pendingWorks} | ⏳ |
| **Failed Works** | ${metrics.failedWorks} | ❌ |
| **Total Executions** | ${metrics.totalExecutions} | ⚡ |
| **Success Rate** | ${metrics.successRate}% | 🎯 |
| **Registered Actors** | ${metrics.totalActors} | 🤖 |
| **Ingested Signals** | ${metrics.totalSignals} | 📡 |

---

## 2. Work Items
| Title | Status | Priority | Actor | Created | ID |
| :--- | :--- | :--- | :--- | :--- | :--- |
${
  works.length === 0
    ? '| _No works registered_ | - | - | - | - | - |'
    : works
        .slice(0, 20)
        .map(
          (w) =>
            `| ${w.title.slice(0, 32)} | \`${w.status}\` | ${w.priority} | ${
              w.assignedActorId || '-'
            } | ${w.createdAt.slice(0, 19)} | \`${w.id.slice(0, 8)}...\` |`,
        )
        .join('\n')
}

---

## 3. Registered Actors
| ID | Name | Type | Availability | Autonomy Level |
| :--- | :--- | :--- | :--- | :--- |
${actors
  .map(
    (a) =>
      `| \`${a.id}\` | ${a.name} | \`${a.type}\` | \`${a.availability}\` | \`${a.autonomyLevel}\` |`,
  )
  .join('\n')}

---

## 4. Factory Lineage Graph (Mermaid)
\`\`\`mermaid
${mermaidGraph}
\`\`\`
`;
  }

  /**
   * Generate the Executive Web Dashboard: a modern, responsive, print-friendly
   * corporate dashboard with six executive tabs, real-time SSE log streaming and
   * quick export actions for the Manager-Ready report.
   */
  generateHtmlDashboard(options?: ReporterOptions): string {
    const data = this.getExecutiveData(options);
    const metrics = data.metrics;
    const works = data.works;
    const actors = data.actors;
    const timestamp = new Date().toISOString();
    const title = options?.title || 'Software Factory Dashboard';

    const statusClass = (status: string): string => {
      switch (status) {
        case WorkStatus.COMPLETED:
        case ExecutionStatus.COMPLETED:
          return 'badge-success';
        case WorkStatus.IN_PROGRESS:
        case ExecutionStatus.RUNNING:
          return 'badge-primary';
        case WorkStatus.PENDING:
        case WorkStatus.BLOCKED:
          return 'badge-warning';
        case WorkStatus.FAILED:
        case ExecutionStatus.FAILED:
          return 'badge-danger';
        default:
          return 'badge-neutral';
      }
    };

    const getStatusBadge = (status: string) =>
      `<span class="badge ${statusClass(status)}">${escapeHtml(status)}</span>`;

    const worksRows =
      works.length === 0
        ? '<tr><td colspan="6" class="empty">No work items registered</td></tr>'
        : works
            .slice(0, 50)
            .map((w) => {
              const execs = this.store.listExecutionsForWork(w.id).length;
              return `
          <tr>
            <td class="cell-title">${escapeHtml(w.title)}<br/><small class="text-muted">${escapeHtml(w.id)}</small></td>
            <td>${getStatusBadge(w.status)}</td>
            <td><span class="badge badge-outline">${escapeHtml(w.priority)}</span></td>
            <td><code>${escapeHtml(w.leadActor)}</code></td>
            <td>${execs}</td>
            <td>${this.deliverableReferenceHtml(w)}</td>
          </tr>`;
            })
            .join('');

    const actorsRows =
      actors.length === 0
        ? '<tr><td colspan="6" class="empty">No actors registered</td></tr>'
        : actors
            .map(
              (a) => `
          <tr>
            <td><code>${escapeHtml(a.actorId)}</code></td>
            <td class="cell-title">${escapeHtml(a.name)}</td>
            <td><span class="badge badge-outline">${escapeHtml(a.roleLabel)}</span></td>
            <td><span class="badge badge-neutral">${escapeHtml(a.type)}</span></td>
            <td><span class="badge ${
              a.availability === 'available' ? 'badge-success' : 'badge-warning'
            }">${escapeHtml(a.availability)}</span></td>
            <td>${a.totalExecutions}</td>
            <td>${a.successRate}%</td>
          </tr>`,
            )
            .join('');

    const gatesRows =
      data.qualityGates.length === 0
        ? '<tr><td colspan="5" class="empty">No quality gates recorded</td></tr>'
        : data.qualityGates
            .map(
              (g) => `
          <tr>
            <td class="cell-title">${escapeHtml(g.name)}</td>
            <td><span class="gate gate-${escapeHtml(g.status)}">${escapeHtml(g.status)}</span></td>
            <td>${g.total}</td>
            <td>${g.passed}</td>
            <td>${g.failed}</td>
          </tr>`,
            )
            .join('');

    const risksRows =
      data.risks.length === 0
        ? '<tr><td colspan="4" class="empty">No active risks</td></tr>'
        : data.risks
            .map(
              (r) => `
          <tr>
            <td class="cell-title">${escapeHtml(r.title)}</td>
            <td><span class="severity severity-${escapeHtml(r.severity)}">${escapeHtml(
              r.severity,
            )}</span></td>
            <td>${escapeHtml(r.impact)}</td>
            <td>${escapeHtml(r.mitigation)}</td>
          </tr>`,
            )
            .join('');

    const nextActionsHtml = data.nextActions
      .map((a) => `<li>${escapeHtml(a)}</li>`)
      .join('');

    const pendingApprovalsHtml =
      data.pendingApprovals.length === 0
        ? '<li>No pending approvals.</li>'
        : data.pendingApprovals
            .map((w) => `<li>${escapeHtml(w.title)} — ${this.deliverableReferenceHtml(w)}</li>`)
            .join('');

    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    window.__factoryMermaid = mermaid;
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
    window.dispatchEvent(new Event('factory:mermaid-ready'));
  </script>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --primary: #58a6ff;
      --success: #238636;
      --warning: #d29922;
      --danger: #da3633;
      --accent-soft: rgba(88, 166, 255, 0.12);
    }
    body[data-theme="light"] {
      --bg: #eef1f6;
      --card-bg: #ffffff;
      --border: #d8dee9;
      --text: #14213d;
      --text-muted: #5b6b86;
      --primary: #14428f;
      --accent-soft: #e8eefb;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: "Vazirmatn", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Tahoma, sans-serif;
      line-height: 1.6;
      padding: 24px;
      transition: background-color 0.2s ease, color 0.2s ease;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      padding-bottom: 20px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    .header-title h1 { font-size: 24px; font-weight: 700; }
    .header-title p { color: var(--text-muted); font-size: 13px; margin-top: 4px; }
    .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .tab-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 22px;
      padding: 6px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .tab-btn {
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 8px 14px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tab-btn:hover { color: var(--text); background: var(--accent-soft); }
    .tab-btn.active {
      color: #fff;
      background: var(--primary);
    }
    body[data-theme="light"] .tab-btn.active { color: #fff; }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; animation: fade 0.2s ease; }
    @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 18px;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .kpi-card:hover { transform: translateY(-2px); border-color: var(--primary); }
    .kpi-title { font-size: 12px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-value { font-size: 32px; font-weight: 700; margin-top: 6px; }
    .kpi-sub { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .card-title {
      font-size: 17px;
      font-weight: 700;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .card-title .fa { color: var(--text-muted); font-size: 13px; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; text-align: right; }
    th { color: var(--text-muted); font-weight: 600; padding: 12px 14px; border-bottom: 1px solid var(--border); }
    td { padding: 12px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    tr:hover td { background: var(--accent-soft); }
    .cell-title { font-weight: 600; }
    .empty { text-align: center; color: var(--text-muted); padding: 24px; }
    .badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      border: 1px solid transparent;
    }
    .badge-success { background: rgba(35, 134, 54, 0.2); color: #3fb950; border-color: rgba(35, 134, 54, 0.4); }
    body[data-theme="light"] .badge-success { color: #1d7a3d; }
    .badge-primary { background: rgba(88, 166, 255, 0.15); color: #58a6ff; border-color: rgba(88, 166, 255, 0.3); }
    body[data-theme="light"] .badge-primary { color: #14428f; }
    .badge-warning, .gate-warn, .severity-medium { background: rgba(210, 153, 34, 0.2); color: #d29922; border-color: rgba(210, 153, 34, 0.4); }
    body[data-theme="light"] .badge-warning, body[data-theme="light"] .gate-warn, body[data-theme="light"] .severity-medium { color: #9a6a10; }
    .badge-danger, .gate-fail, .severity-high { background: rgba(218, 54, 51, 0.2); color: #f85149; border-color: rgba(218, 54, 51, 0.4); }
    body[data-theme="light"] .badge-danger, body[data-theme="light"] .gate-fail, body[data-theme="light"] .severity-high { color: #a32323; }
    .badge-neutral { background: rgba(139, 148, 158, 0.2); color: var(--text-muted); }
    .badge-outline { border: 1px solid var(--border); color: var(--text-muted); }
    .gate, .severity { display: inline-block; padding: 3px 9px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .gate-pass { background: rgba(35, 134, 54, 0.2); color: #3fb950; }
    .severity-low { background: rgba(88, 166, 255, 0.15); color: #58a6ff; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; background: rgba(110, 118, 129, 0.2); padding: 2px 6px; border-radius: 4px; }
    .mermaid-box {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
      text-align: center;
      min-height: 200px;
    }
    .terminal-box {
      background: #05080c;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.6;
      height: 320px;
      overflow-y: auto;
      color: #c9d1d9;
      direction: ltr;
      text-align: left;
    }
    .log-line { margin-bottom: 4px; word-break: break-word; }
    .log-timestamp { color: #8b949e; margin-right: 8px; font-size: 11px; }
    .log-actor { color: #58a6ff; font-weight: 600; margin-right: 8px; }
    .log-info { color: #7ee787; }
    .log-warn { color: #f2cc60; }
    .log-error { color: #ff7b72; }
    .log-muted { color: #8b949e; }
    .text-muted { color: var(--text-muted); }
    .report-frame { width: 100%; height: 70vh; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
    .btn {
      background: var(--primary);
      color: #fff;
      border: 1px solid var(--primary);
      border-radius: 7px;
      padding: 8px 14px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    .btn:hover { opacity: 0.9; }
    .btn.ghost { background: transparent; color: var(--primary); }
    .actions-list { padding-right: 22px; }
    .actions-list li { margin: 6px 0; }
    footer { text-align: center; color: var(--text-muted); font-size: 12px; margin-top: 40px; }
    @page { size: A4; margin: 14mm; }
    @media print {
      body { background: #fff; color: #000; padding: 0; }
      .no-print, .tab-nav, .header-actions { display: none !important; }
      .tab-pane { display: block !important; page-break-before: always; }
      .tab-pane:first-of-type { page-break-before: avoid; }
      .card, .kpi-card { border-color: #ccc; box-shadow: none; page-break-inside: avoid; }
      .report-frame { height: auto; min-height: 240mm; display: block; }
      a { color: #000; text-decoration: none; }
    }
  </style>
</head>
<body data-theme="dark">
  <div class="container">
    <header>
      <div class="header-title">
        <h1>🏭 ${escapeHtml(title)}</h1>
        <p>Software Factory System of Coordination &bull; ${escapeHtml(data.gregorianDateTime)} &bull; ${escapeHtml(data.shamsiDateTime)}</p>
      </div>
      <div class="header-actions no-print">
        <button class="btn ghost" type="button" onclick="factoryToggleTheme()">🌓 Theme</button>
        <a class="btn ghost" href="/report/manager.md" target="_blank" rel="noopener">⬇️ Markdown</a>
        <a class="btn" href="/report/manager" target="_blank" rel="noopener">🖨️ Manager Report</a>
      </div>
    </header>

    <nav class="tab-nav no-print" role="tablist" aria-label="Executive dashboard tabs">
      <button class="tab-btn active" role="tab" data-tab="overview" onclick="factoryShowTab('overview')">Overview · نمای کلان</button>
      <button class="tab-btn" role="tab" data-tab="deliverables" onclick="factoryShowTab('deliverables')">Deliverables &amp; Pipeline · خط تحویل</button>
      <button class="tab-btn" role="tab" data-tab="fleet" onclick="factoryShowTab('fleet')">Agent Fleet · ناوگان عامل‌ها</button>
      <button class="tab-btn" role="tab" data-tab="manager" onclick="factoryShowTab('manager')">Manager Report · گزارش رسمی</button>
      <button class="tab-btn" role="tab" data-tab="console" onclick="factoryShowTab('console')">Live Console · کنسول زنده</button>
      <button class="tab-btn" role="tab" data-tab="lineage" onclick="factoryShowTab('lineage')">Lineage Graph · گراف علیت</button>
    </nav>

    <!-- 1. OVERVIEW -->
    <section class="tab-pane active" id="tab-overview" role="tabpanel">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">Total Works</div>
          <div class="kpi-value">${metrics.totalWorks}</div>
          <div class="kpi-sub">${metrics.completedWorks} completed &bull; ${metrics.pendingWorks} pending</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Success Rate</div>
          <div class="kpi-value" style="color: ${metrics.successRate >= 80 ? '#3fb950' : '#d29922'}">${metrics.successRate}%</div>
          <div class="kpi-sub">${metrics.successfulExecutions} / ${metrics.totalExecutions} executions</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Automation Rate</div>
          <div class="kpi-value">${data.automationRate}%</div>
          <div class="kpi-sub">Autonomous agent share</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Registered Actors</div>
          <div class="kpi-value">${metrics.totalActors}</div>
          <div class="kpi-sub">Human + software agents</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Ingested Signals</div>
          <div class="kpi-value">${metrics.totalSignals}</div>
          <div class="kpi-sub">Telegram &bull; GitHub &bull; CLI</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Failed Works</div>
          <div class="kpi-value" style="color: ${metrics.failedWorks > 0 ? '#f85149' : '#3fb950'}">${metrics.failedWorks}</div>
          <div class="kpi-sub">${metrics.failedExecutions} failed executions</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>📊 Operational Status</span><span class="fa">وضعیت عملیاتی</span></div>
        <p>Factory status: <strong>${escapeHtml(data.status)}</strong> &bull; Report number: <code>${escapeHtml(data.reportNumber)}</code></p>
        <p class="text-muted">Coverage window: ${escapeHtml(data.coverageWindow.label)}</p>
      </div>

      <div class="card">
        <div class="card-title"><span>🛡️ Quality Gates</span><span class="fa">دروازه‌های کنترل کیفیت</span></div>
        <table>
          <thead><tr><th>Gate</th><th>Status</th><th>Total</th><th>Passed</th><th>Failed</th></tr></thead>
          <tbody>${gatesRows}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title"><span>⚠️ Risks &amp; Bottlenecks</span><span class="fa">ریسک و گلوگاه‌ها</span></div>
        <table>
          <thead><tr><th>Risk</th><th>Severity</th><th>Impact</th><th>Mitigation</th></tr></thead>
          <tbody>${risksRows}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title"><span>✅ Next Actions</span><span class="fa">اقدامات بعدی</span></div>
        <ol class="actions-list">${nextActionsHtml}</ol>
      </div>
    </section>

    <!-- 2. DELIVERABLES & PIPELINE -->
    <section class="tab-pane" id="tab-deliverables" role="tabpanel">
      <div class="card">
        <div class="card-title">
          <span>📋 Deliverables &amp; Pipeline (${works.length})</span>
          <span class="fa">خط تحویل و پروژه‌ها</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Title &amp; ID</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Lead Actor</th>
              <th>Executions</th>
              <th>Issue / PR</th>
            </tr>
          </thead>
          <tbody>${worksRows}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title"><span>🚦 Pending Approvals</span><span class="fa">در انتظار تأیید</span></div>
        <ul class="actions-list">${pendingApprovalsHtml}</ul>
      </div>
    </section>

    <!-- 3. AGENT FLEET -->
    <section class="tab-pane" id="tab-fleet" role="tabpanel">
      <div class="card">
        <div class="card-title">
          <span>🤖 Agent Fleet Performance (${actors.length})</span>
          <span class="fa">ناوگان عامل‌ها</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Role</th>
              <th>Type</th>
              <th>Availability</th>
              <th>Executions</th>
              <th>Success</th>
            </tr>
          </thead>
          <tbody>${actorsRows}</tbody>
        </table>
      </div>
    </section>

    <!-- 4. MANAGER REPORT VIEW -->
    <section class="tab-pane" id="tab-manager" role="tabpanel">
      <div class="card">
        <div class="card-title">
          <span>🖨️ Manager-Ready Report</span>
          <span class="fa">مشاهده و پرینت گزارش رسمی</span>
        </div>
        <p>Quick export:
          <a class="btn ghost" href="/report/manager" target="_blank" rel="noopener">HTML (print / PDF)</a>
          <a class="btn ghost" href="/report/manager.md" target="_blank" rel="noopener">Markdown</a>
          <button class="btn no-print" type="button" onclick="factoryPrintReport()">Print report</button>
        </p>
        <iframe class="report-frame no-print" id="manager-report-frame" src="/report/manager" title="Manager report"></iframe>
      </div>
    </section>

    <!-- 5. LIVE LOG CONSOLE -->
    <section class="tab-pane" id="tab-console" role="tabpanel">
      <div class="card">
        <div class="card-title">
          <span>🔴 Live Execution Stream & Logs</span>
          <span id="stream-status" class="badge badge-warning">Connecting to /api/live...</span>
        </div>
        <div class="terminal-box" id="terminal-logs">
          <div class="log-line"><span class="log-timestamp">[--:--:--]</span> <span class="log-actor">[System]</span> <span class="log-muted">Waiting for events from /api/live...</span></div>
        </div>
      </div>
    </section>

    <!-- 6. LINEAGE GRAPH -->
    <section class="tab-pane" id="tab-lineage" role="tabpanel">
      <div class="card">
        <div class="card-title"><span>🌐 Lineage &amp; Causality Graph</span><span class="fa">گراف علیت و تبار</span></div>
        <div class="mermaid-box">
          <pre class="mermaid">
${data.lineageMermaid}
          </pre>
        </div>
      </div>
    </section>

    <footer>
      Software Factory (Concept v31) &bull; Coordinates Humans, Agents &amp; External Systems &bull; Last updated: ${timestamp}
    </footer>
  </div>

  <script>
    (function() {
      'use strict';

      // --- Tab navigation ---
      window.factoryShowTab = function(name) {
        var panes = document.querySelectorAll('.tab-pane');
        var buttons = document.querySelectorAll('.tab-btn');
        for (var i = 0; i < panes.length; i++) {
          panes[i].classList.toggle('active', panes[i].id === 'tab-' + name);
        }
        for (var j = 0; j < buttons.length; j++) {
          buttons[j].classList.toggle('active', buttons[j].getAttribute('data-tab') === name);
        }
        if (name === 'lineage') { renderMermaid(); }
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#' + name);
        }
        document.dispatchEvent(new CustomEvent('factory:tab', { detail: name }));
      };

      var initialTab = (window.location.hash || '').replace('#', '');
      if (initialTab) { window.factoryShowTab(initialTab); }

      // --- Theme toggle (dark / light) ---
      window.factoryToggleTheme = function() {
        var body = document.body;
        body.setAttribute('data-theme', body.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
      };

      // --- Print the manager report iframe ---
      window.factoryPrintReport = function() {
        var frame = document.getElementById('manager-report-frame');
        if (frame && frame.contentWindow) { frame.contentWindow.focus(); frame.contentWindow.print(); }
        else { window.open('/report/manager', '_blank'); }
      };

      // --- Lazy Mermaid rendering ---
      var mermaidRendered = false;
      function renderMermaid() {
        if (mermaidRendered || !window.__factoryMermaid) { return; }
        var el = document.querySelector('.mermaid');
        var pane = document.getElementById('tab-lineage');
        if (!el || !pane || !pane.classList.contains('active')) { return; }
        mermaidRendered = true;
        try { window.__factoryMermaid.run({ nodes: [el] }); } catch (e) { mermaidRendered = false; }
      }
      window.addEventListener('factory:mermaid-ready', renderMermaid);
      document.addEventListener('factory:tab', function(e) { if (e.detail === 'lineage') { renderMermaid(); } });

      // --- Live SSE log console ---
      var terminal = document.getElementById('terminal-logs');
      var statusBadge = document.getElementById('stream-status');

      function escapeHtmlText(str) {
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      function appendLog(text, actor, level) {
        if (!terminal) return;
        actor = actor || 'System';
        level = level || 'info';
        var time = new Date().toLocaleTimeString();
        var line = document.createElement('div');
        line.className = 'log-line';
        line.innerHTML = '<span class="log-timestamp">[' + time + ']</span> ' +
          '<span class="log-actor">[' + escapeHtmlText(actor) + ']</span> ' +
          '<span class="log-' + level + '">' + escapeHtmlText(text) + '</span>';
        terminal.appendChild(line);
        terminal.scrollTop = terminal.scrollHeight;
      }

      if (window.EventSource) {
        var es = new EventSource('/api/live');
        es.addEventListener('connected', function() {
          if (statusBadge) {
            statusBadge.textContent = '🟢 Live Connected';
            statusBadge.className = 'badge badge-success';
          }
          appendLog('Live event stream connected', 'Dashboard', 'info');
        });
        es.addEventListener('log', function(e) {
          try {
            var data = JSON.parse(e.data);
            appendLog(data.message, data.actor, data.level || 'info');
          } catch (err) {}
        });
        es.addEventListener('progress', function(e) {
          try {
            var data = JSON.parse(e.data);
            var msg = 'Progress [' + data.step + ']: ' + data.status + (data.detail ? ' (' + data.detail + ')' : '');
            appendLog(msg, 'Pipeline', data.status === 'failed' ? 'error' : 'warn');
          } catch (err) {}
        });
        es.onerror = function() {
          if (statusBadge) {
            statusBadge.textContent = '⚠️ Stream Disconnected';
            statusBadge.className = 'badge badge-warning';
          }
        };
      } else {
        appendLog('EventSource is not supported in this browser.', 'Warning', 'error');
      }
    })();
  </script>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------------
  // Executive data aggregation & manager-ready reporting
  // ---------------------------------------------------------------------------

  /**
   * Format a date using the Persian Solar Hijri calendar via native Intl.
   */
  private formatShamsi(date: Date, withTime = false): string {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    };
    if (withTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    try {
      return new Intl.DateTimeFormat('fa-IR-u-ca-persian', options).format(date);
    } catch {
      return new Intl.DateTimeFormat('fa-IR', options).format(date);
    }
  }

  /**
   * Format a date using the Gregorian calendar via native Intl.
   */
  private formatGregorian(date: Date, withTime = false): string {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      timeZone: 'UTC',
    };
    if (withTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.timeZoneName = 'short';
    }
    return new Intl.DateTimeFormat('en-US', options).format(date);
  }

  /**
   * Produce an ISO-like Persian calendar date (latin digits) for report numbers.
   */
  private shamsiIso(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  /**
   * Convert Persian/Arabic digits in a string to latin digits.
   */
  private toLatinDigits(value: string): string {
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    return value
      .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)));
  }

  private trailingNumber(uri: string): number | undefined {
    const match = uri.match(/(\d+)(?:\?.*)?$/);
    return match ? Number(match[1]) : undefined;
  }

  /**
   * Resolve a GitHub Issue/PR web URL from a canonical Factory reference URI.
   */
  private urlFromGithubUri(uri: string, kind: 'issue' | 'pr'): string | undefined {
    const stored = this.store.getReferenceByUri(uri);
    if (stored?.metadata?.url) {
      return String(stored.metadata.url);
    }
    const match = uri.match(/^github:\/\/(issue|pr)\/(.+?)\/(\d+)$/);
    if (!match) return undefined;
    const repo = match[2];
    const number = match[3];
    const segment = kind === 'pr' ? 'pull' : 'issues';
    return `https://github.com/${repo}/${segment}/${number}`;
  }

  /**
   * Extract deliverable links (Issue/PR) for a work item from context, relations and executions.
   */
  private resolveDeliverableLinks(work: Work): {
    issueUrl?: string;
    issueNumber?: number;
    prUrl?: string;
    prNumber?: number;
  } {
    const ctx = work.context || {};
    const result: {
      issueUrl?: string;
      issueNumber?: number;
      prUrl?: string;
      prNumber?: number;
    } = {};

    if (ctx.issueNumber !== undefined && ctx.issueNumber !== null) {
      result.issueNumber = Number(ctx.issueNumber);
    }
    if (ctx.issueUrl) result.issueUrl = String(ctx.issueUrl);
    if (ctx.prNumber !== undefined && ctx.prNumber !== null) {
      result.prNumber = Number(ctx.prNumber);
    }
    if (ctx.prUrl) result.prUrl = String(ctx.prUrl);

    const relations = this.store.getRelationsForSource(CanonicalUri.factoryWork(work.id));
    for (const rel of relations) {
      if (rel.targetRef.startsWith('github://issue/')) {
        result.issueNumber = result.issueNumber ?? this.trailingNumber(rel.targetRef);
        result.issueUrl = result.issueUrl || this.urlFromGithubUri(rel.targetRef, 'issue');
      } else if (rel.targetRef.startsWith('github://pr/')) {
        result.prNumber = result.prNumber ?? this.trailingNumber(rel.targetRef);
        result.prUrl = result.prUrl || this.urlFromGithubUri(rel.targetRef, 'pr');
      }
    }

    if (!result.prUrl || !result.issueUrl) {
      for (const ex of this.store.listExecutionsForWork(work.id)) {
        for (const ref of ex.producedReferences || []) {
          if (!result.prUrl && ref.startsWith('github://pr/')) {
            result.prNumber = result.prNumber ?? this.trailingNumber(ref);
            result.prUrl = this.urlFromGithubUri(ref, 'pr');
          }
          if (!result.issueUrl && ref.startsWith('github://issue/')) {
            result.issueNumber = result.issueNumber ?? this.trailingNumber(ref);
            result.issueUrl = this.urlFromGithubUri(ref, 'issue');
          }
        }
      }
    }

    return result;
  }

  private toExecutiveWorkItem(work: Work): ExecutiveWorkItem {
    const links = this.resolveDeliverableLinks(work);
    return {
      id: work.id,
      title: work.title,
      status: work.status,
      priority: work.priority,
      workType: work.type,
      leadActor: work.assignedActorId || 'تعیین‌نشده',
      issueUrl: links.issueUrl,
      issueNumber: links.issueNumber,
      prUrl: links.prUrl,
      prNumber: links.prNumber,
      branchName: work.context?.branchName,
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
    };
  }

  private classifyActorRole(actorId: string, type: string): string {
    if (type === 'human' || actorId.startsWith('human:')) return 'human_gate';
    const id = actorId.toLowerCase();
    if (id.includes('claude')) return 'reviewer';
    if (id.includes('opencode') || id.includes('agy') || id.includes('antigravity')) {
      return 'implementer';
    }
    return 'agent';
  }

  private roleLabel(role: string): string {
    switch (role) {
      case 'implementer':
        return 'پیاده‌سازی و توسعه';
      case 'reviewer':
        return 'بازبینی و کنترل کیفیت';
      case 'human_gate':
        return 'دروازه انسانی و تأیید نهایی';
      default:
        return 'عامل اجرایی';
    }
  }

  private workStatusLabel(status: string): string {
    switch (status) {
      case WorkStatus.COMPLETED:
        return 'تکمیل‌شده';
      case WorkStatus.IN_PROGRESS:
        return 'در جریان';
      case WorkStatus.PENDING:
        return 'در انتظار';
      case WorkStatus.BLOCKED:
        return 'متوقف‌شده';
      case WorkStatus.FAILED:
        return 'ناموفق';
      case WorkStatus.CANCELLED:
        return 'لغو‌شده';
      default:
        return status;
    }
  }

  private priorityLabel(priority: string): string {
    switch (priority) {
      case WorkPriority.LOW:
        return 'کم';
      case WorkPriority.MEDIUM:
        return 'متوسط';
      case WorkPriority.HIGH:
        return 'بالا';
      case WorkPriority.CRITICAL:
        return 'بحرانی';
      default:
        return priority;
    }
  }

  private workTypeLabel(type: string): string {
    switch (type) {
      case WorkType.IMPLEMENTATION:
        return 'پیاده‌سازی';
      case WorkType.INVESTIGATION:
        return 'بررسی';
      case WorkType.TEST:
        return 'آزمون';
      case WorkType.REVIEW:
        return 'بازبینی';
      case WorkType.APPROVAL:
        return 'تأیید';
      case WorkType.DEPLOY:
        return 'استقرار';
      case WorkType.PLANNING:
        return 'برنامه‌ریزی';
      default:
        return 'سفارشی';
    }
  }

  private gateStatusLabel(status: string): string {
    if (status === 'pass') return 'تأییدشده';
    if (status === 'warn') return 'نیازمند توجه';
    return 'ناموفق';
  }

  private riskSeverityLabel(severity: string): string {
    if (severity === 'high') return 'بالا';
    if (severity === 'medium') return 'متوسط';
    return 'پایین';
  }

  /**
   * Aggregate high-level executive metrics, delivery status, actor performance,
   * quality gates and risk analysis into a single payload.
   */
  getExecutiveData(options?: ReporterOptions): ExecutiveData {
    const now = new Date();
    const metrics = this.getSummaryMetrics();
    const works = this.store.listWorks();
    const actors = this.store.listActors();

    const coverageFrom = options?.coverageFrom
      ? new Date(options.coverageFrom)
      : works.length
        ? new Date(
            works.reduce(
              (min, w) => (w.createdAt < min ? w.createdAt : min),
              works[0].createdAt,
            ),
          )
        : now;
    const coverageTo = options?.coverageTo ? new Date(options.coverageTo) : now;

    const reportNumber =
      options?.reportNumber ||
      `SF-EXEC-${this.shamsiIso(now).replace(/-/g, '')}-${String(metrics.totalWorks).padStart(3, '0')}`;

    // Flatten executions once for actor performance and automation rate.
    const executions: Execution[] = [];
    for (const w of works) {
      executions.push(...this.store.listExecutionsForWork(w.id));
    }

    const actorById = new Map(actors.map((a) => [a.id, a]));

    const execByActor = new Map<string, { total: number; completed: number; failed: number }>();
    let agentExecutions = 0;
    for (const ex of executions) {
      const bucket = execByActor.get(ex.actorId) || { total: 0, completed: 0, failed: 0 };
      bucket.total++;
      if (ex.status === ExecutionStatus.COMPLETED) bucket.completed++;
      else if (ex.status === ExecutionStatus.FAILED) bucket.failed++;
      execByActor.set(ex.actorId, bucket);

      const actor = actorById.get(ex.actorId);
      if (!actor || actor.type !== 'human') agentExecutions++;
    }

    const actorPerformance: ExecutiveActorPerformance[] = actors.map((a) => {
      const bucket = execByActor.get(a.id) || { total: 0, completed: 0, failed: 0 };
      const role = this.classifyActorRole(a.id, a.type);
      return {
        actorId: a.id,
        name: a.name,
        role,
        roleLabel: this.roleLabel(role),
        type: a.type,
        availability: a.availability,
        autonomyLevel: a.autonomyLevel,
        totalExecutions: bucket.total,
        completedExecutions: bucket.completed,
        failedExecutions: bucket.failed,
        successRate:
          bucket.total > 0 ? Math.round((bucket.completed / bucket.total) * 100) : 100,
        assignedWorks: works.filter((w) => w.assignedActorId === a.id).length,
      };
    });

    const executiveWorks = works.map((w) => this.toExecutiveWorkItem(w));

    const pendingApprovals = executiveWorks.filter(
      (w) =>
        (!!w.prUrl && w.status !== WorkStatus.COMPLETED && w.status !== WorkStatus.CANCELLED) ||
        (w.workType === WorkType.APPROVAL && w.status !== WorkStatus.COMPLETED),
    );

    // --- Quality gates ---
    const testWorks = works.filter((w) => w.type === WorkType.TEST);
    const reviewWorks = works.filter((w) => w.type === WorkType.REVIEW);
    const verifiesCount = this.store
      .getAllRelations()
      .filter((r) => r.relationType === RelationType.VERIFIES).length;

    const qualityGates: ExecutiveQualityGate[] = [];

    const testTotal = testWorks.length;
    const testPassed = testWorks.filter((w) => w.status === WorkStatus.COMPLETED).length;
    const testFailed = testWorks.filter((w) => w.status === WorkStatus.FAILED).length;
    if (testTotal > 0) {
      qualityGates.push({
        id: 'tests',
        name: 'آزمون‌های واحد و یکپارچگی',
        total: testTotal,
        passed: testPassed,
        failed: testFailed,
        status: testFailed > 0 ? 'fail' : testPassed === testTotal ? 'pass' : 'warn',
        detail: `از ${testTotal} کار آزمون ثبت‌شده، ${testPassed} مورد با موفقیت تأیید شده است.`,
      });
    } else {
      qualityGates.push({
        id: 'tests',
        name: 'آزمون‌های واحد و یکپارچگی',
        total: metrics.totalExecutions,
        passed: metrics.successfulExecutions,
        failed: metrics.failedExecutions,
        status: metrics.successRate >= 80 ? 'pass' : 'warn',
        detail: `نرخ موفقیت اجرای خودکار ${metrics.successRate} درصد در مجموع ${metrics.totalExecutions} اجرا.`,
      });
    }

    const reviewTotal = reviewWorks.length;
    const reviewPassed = reviewWorks.filter((w) => w.status === WorkStatus.COMPLETED).length;
    const reviewFailed = reviewWorks.filter((w) => w.status === WorkStatus.FAILED).length;
    qualityGates.push({
      id: 'code_review',
      name: 'بازبینی کد و کنترل کیفیت',
      total: reviewTotal,
      passed: reviewPassed,
      failed: reviewFailed,
      status:
        reviewTotal === 0
          ? 'warn'
          : reviewFailed > 0
            ? 'fail'
            : reviewPassed === reviewTotal
              ? 'pass'
              : 'warn',
      detail:
        reviewTotal === 0
          ? 'کار بازبینی رسمی در بازه گزارش ثبت نشده است؛ بازبینی در چرخه تحویل بعدی انجام می‌شود.'
          : `از ${reviewTotal} کار بازبینی، ${reviewPassed} مورد با موفقیت تأیید شده است.`,
    });

    const securityTotal = Math.max(reviewTotal, verifiesCount);
    qualityGates.push({
      id: 'security',
      name: 'بررسی‌های امنیتی و انطباق',
      total: securityTotal,
      passed: reviewPassed,
      failed: reviewFailed,
      status: reviewFailed > 0 ? 'fail' : securityTotal > 0 ? 'pass' : 'warn',
      detail:
        securityTotal > 0
          ? `مجموع ${securityTotal} نقطه کنترل امنیتی و انطباق در زنجیره تحویل بررسی شده است.`
          : 'نقطه کنترل امنیتی مستقل در بازه گزارش ثبت نشده است.',
    });

    // --- Risk & bottleneck analysis ---
    const risks: ExecutiveRisk[] = [];

    risks.push({
      id: 'human_gate',
      title: 'ظرفیت دروازه بازبینی انسانی',
      severity:
        pendingApprovals.length >= 3 ? 'high' : pendingApprovals.length >= 2 ? 'medium' : 'low',
      impact:
        pendingApprovals.length > 0
          ? `${pendingApprovals.length} تحویل در انتظار تأیید انسانی است و تکمیل زنجیره تحویل را محدود می‌کند.`
          : 'در حال حاضر موردی در انتظار تأیید انسانی وجود ندارد.',
      mitigation:
        pendingApprovals.length > 0
          ? 'زمان‌بندی جلسات تأیید و اولویت‌بندی درخواست‌های ادغام در انتظار.'
          : 'حفظ آمادگی دروازه انسانی برای تحویل‌های آینده.',
    });

    if (metrics.failedExecutions > 0 || metrics.failedWorks > 0) {
      risks.push({
        id: 'agent_reliability',
        title: 'پایداری اجرای عامل‌ها',
        severity: metrics.failedExecutions >= 3 ? 'high' : 'medium',
        impact: `${metrics.failedExecutions} اجرا و ${metrics.failedWorks} کار با خطا خاتمه یافته است.`,
        mitigation:
          'فعال‌سازی سازوکار جانشینی خودکار و بازبینی علت ریشه‌ای خطاها پیش از تحویل بعدی.',
      });
    }

    const unavailableActors = actorPerformance.filter((a) => a.availability !== 'available');
    if (unavailableActors.length > 0) {
      risks.push({
        id: 'dependencies',
        title: 'وابستگی به سرویس‌ها و عامل‌های بیرونی',
        severity: 'medium',
        impact: `عامل‌های ${unavailableActors.map((a) => a.name).join('، ')} در وضعیت آمادگی کامل نیستند.`,
        mitigation:
          'پایش مستمر سلامت عامل‌ها و تعریف مسیر جایگزین برای هر مرحله حیاتی تحویل.',
      });
    }

    // --- Next actions ---
    const nextActions: string[] = [];
    if (pendingApprovals.length > 0) {
      nextActions.push(
        `بررسی و تصمیم‌گیری درباره ${pendingApprovals.length} تحویل در انتظار تأیید مدیریتی.`,
      );
    }
    const activeWorks = metrics.inProgressWorks + metrics.pendingWorks;
    if (activeWorks > 0) {
      nextActions.push(`تداوم پیشبرد ${activeWorks} کار در جریان یا در انتظار اجرا.`);
    }
    if (metrics.failedWorks > 0) {
      nextActions.push(
        `ارائه گزارش علت ریشه‌ای و برنامه جبرانی برای ${metrics.failedWorks} کار ناموفق.`,
      );
    }
    nextActions.push('اجرای کامل آزمون‌های خودکار و کنترل کیفیت پیش از هر ادغام در شاخه اصلی.');
    if (nextActions.length === 0) {
      nextActions.push('ادامه پایش عملیاتی و پذیرش کارهای جدید در چرخه تحویل.');
    }

    const status =
      metrics.totalWorks === 0
        ? 'در حال راه‌اندازی'
        : metrics.failedWorks > 0
          ? 'نیازمند توجه'
          : metrics.completedWorks > 0
            ? 'عملیاتی و پایدار'
            : 'در حال اجرا';

    const automationRate =
      metrics.totalExecutions > 0
        ? Math.round((agentExecutions / metrics.totalExecutions) * 100)
        : 100;

    const fromShamsi = this.formatShamsi(coverageFrom);
    const toShamsi = this.formatShamsi(coverageTo);
    const shamsiDate = this.formatShamsi(now);

    return {
      generatedAt: now.toISOString(),
      gregorianDate: this.formatGregorian(now),
      shamsiDate,
      gregorianDateTime: this.formatGregorian(now, true),
      shamsiDateTime: this.formatShamsi(now, true),
      reportNumber,
      preparedBy: options?.preparedBy || 'سامانه هماهنگی کارخانه نرم‌افزار',
      coverageWindow: {
        from: coverageFrom.toISOString().slice(0, 10),
        to: coverageTo.toISOString().slice(0, 10),
        fromShamsi,
        toShamsi,
        label: `از ${fromShamsi} تا ${toShamsi}`,
      },
      status,
      automationRate,
      metrics,
      works: executiveWorks,
      actors: actorPerformance,
      qualityGates,
      risks,
      nextActions,
      pendingApprovals,
      lineageMermaid: this.toMermaidGraph(options?.workId),
    };
  }

  private sanitizeCell(value: string): string {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  }

  private deliverableReferenceCell(work: ExecutiveWorkItem): string {
    const parts: string[] = [];
    if (work.issueUrl) {
      parts.push(`[شماره ${work.issueNumber ?? '-'}](${work.issueUrl})`);
    } else if (work.issueNumber) {
      parts.push(`شماره ${work.issueNumber}`);
    }
    if (work.prUrl) {
      parts.push(
        work.prNumber
          ? `[درخواست ادغام ${work.prNumber}](${work.prUrl})`
          : `[درخواست ادغام](${work.prUrl})`,
      );
    } else if (work.prNumber) {
      parts.push(`درخواست ادغام ${work.prNumber}`);
    }
    return parts.length ? parts.join(' / ') : '---';
  }

  /**
   * Generate the formal Manager-Ready executive report in Markdown (Persian, dual calendar).
   */
  generateManagerReportMarkdown(options?: ReporterOptions): string {
    const data = this.getExecutiveData(options);
    const m = data.metrics;
    const lines: string[] = [];

    lines.push('# گزارش مدیریتی سامانه هماهنگی کارخانه نرم‌افزار');
    lines.push('');
    lines.push('| مشخصه | مقدار |');
    lines.push('| :--- | :--- |');
    lines.push(`| شماره گزارش | ${data.reportNumber} |`);
    lines.push(`| تاریخ (هجری شمسی) | ${data.shamsiDateTime} |`);
    lines.push(`| تاریخ (میلادی) | ${data.gregorianDateTime} |`);
    lines.push(`| بازه پوشش گزارش | ${data.coverageWindow.label} |`);
    lines.push(`| وضعیت کلی | ${data.status} |`);
    lines.push(`| تهیه‌کننده | ${data.preparedBy} |`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // 1. Executive summary
    lines.push('## ۱. خلاصه مدیریتی');
    lines.push('');
    const active = m.inProgressWorks + m.pendingWorks;
    lines.push(
      `در بازه پوشش این گزارش، سامانه هماهنگی کارخانه نرم‌افزار مجموعاً ${m.totalWorks} کار را مدیریت کرده است که ${m.completedWorks} مورد تکمیل، ${active} مورد در جریان یا در انتظار اجرا و ${m.failedWorks} مورد ناموفق بوده است. نرخ موفقیت اجراهای خودکار ${m.successRate} درصد و سهم اجرای خودکار (بدون وابستگی مستقیم به عامل انسانی) ${data.automationRate} درصد بوده است.`,
    );
    lines.push('');
    lines.push('برجسته‌ترین دستاوردهای بازه:');
    lines.push('');
    const completedWorks = data.works.filter((w) => w.status === WorkStatus.COMPLETED);
    if (completedWorks.length === 0) {
      lines.push('- مورد شاخصی برای گزارش در بازه فعلی ثبت نشده است.');
    } else {
      for (const w of completedWorks.slice(0, 6)) {
        lines.push(`- ${this.sanitizeCell(w.title)} (${this.workTypeLabel(w.workType)})`);
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // 2. KPIs
    lines.push('## ۲. شاخص‌های کلیدی عملکرد');
    lines.push('');
    lines.push('| شاخص | مقدار | توضیح |');
    lines.push('| :--- | :--- | :--- |');
    lines.push(`| کل کارها | ${m.totalWorks} | مجموع کارهای ثبت‌شده در بازه |`);
    lines.push(`| کارهای تکمیل‌شده | ${m.completedWorks} | تحویل‌های نهایی‌شده |`);
    lines.push(
      `| کارهای در جریان / در انتظار | ${active} | چرخه‌های فعال و صف اجرا |`,
    );
    lines.push(`| کارهای ناموفق | ${m.failedWorks} | نیازمند رسیدگی |`);
    lines.push(`| کل اجراهای خودکار | ${m.totalExecutions} | تلاش‌های اجرایی ثبت‌شده |`);
    lines.push(`| نرخ موفقیت اجرا | ${m.successRate} درصد | نسبت اجراهای موفق |`);
    lines.push(`| نرخ خودکارسازی | ${data.automationRate} درصد | سهم اجرای عامل‌های خودکار |`);
    lines.push(`| عامل‌های فعال | ${m.totalActors} | انسان و عامل نرم‌افزاری |`);
    lines.push(`| سیگنال‌های دریافتی | ${m.totalSignals} | محرک‌های بیرونی پردازش‌شده |`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // 3. Delivery & works status
    lines.push('## ۳. وضعیت تحویل قابلیت‌ها و کارها');
    lines.push('');
    if (data.works.length === 0) {
      lines.push('_کار ثبت‌شده‌ای برای نمایش وجود ندارد._');
    } else {
      lines.push('| قابلیت / کار | نوع | وضعیت | اولویت | عامل راهبر | ارجاع |');
      lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
      for (const w of data.works.slice(0, 25)) {
        lines.push(
          `| ${this.sanitizeCell(w.title)} | ${this.workTypeLabel(w.workType)} | ${this.workStatusLabel(
            w.status,
          )} | ${this.priorityLabel(w.priority)} | ${this.sanitizeCell(w.leadActor)} | ${this.deliverableReferenceCell(
            w,
          )} |`,
        );
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // 4. Agent fleet performance
    lines.push('## ۴. بازبینی عملکرد ناوگان عامل‌ها');
    lines.push('');
    if (data.actors.length === 0) {
      lines.push('_عاملی برای نمایش وجود ندارد._');
    } else {
      lines.push('| عامل | نقش | نوع | آمادگی | اجرا | نرخ موفقیت | کارهای واگذارشده |');
      lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
      for (const a of data.actors) {
        lines.push(
          `| ${this.sanitizeCell(a.name)} | ${a.roleLabel} | ${a.type} | ${a.availability} | ${a.totalExecutions} | ${a.successRate} درصد | ${a.assignedWorks} |`,
        );
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // 5. Verification & quality gates
    lines.push('## ۵. تضمین کیفیت و دروازه‌های کنترل');
    lines.push('');
    lines.push('| دروازه کنترل | وضعیت | تعداد | موفق | ناموفق | توضیح |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const gate of data.qualityGates) {
      lines.push(
        `| ${gate.name} | ${this.gateStatusLabel(gate.status)} | ${gate.total} | ${gate.passed} | ${gate.failed} | ${this.sanitizeCell(gate.detail)} |`,
      );
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // 6. Risk & bottleneck
    lines.push('## ۶. تحلیل ریسک و گلوگاه‌ها');
    lines.push('');
    lines.push('| ریسک | شدت | اثر | راهکار کاهش |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const risk of data.risks) {
      lines.push(
        `| ${risk.title} | ${this.riskSeverityLabel(risk.severity)} | ${this.sanitizeCell(risk.impact)} | ${this.sanitizeCell(risk.mitigation)} |`,
      );
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // 7. Next actions
    lines.push('## ۷. اقدامات بعدی و تصمیمات مدیریتی');
    lines.push('');
    data.nextActions.forEach((action, idx) => {
      lines.push(`${idx + 1}. ${action}`);
    });
    if (data.pendingApprovals.length > 0) {
      lines.push('');
      lines.push('تحویل‌های در انتظار تأیید مدیریتی:');
      lines.push('');
      for (const w of data.pendingApprovals) {
        lines.push(`- ${this.sanitizeCell(w.title)} (${this.deliverableReferenceCell(w)})`);
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // Appendix
    lines.push('## پیوست: نمودار علت و تبار');
    lines.push('');
    lines.push('```mermaid');
    lines.push(data.lineageMermaid);
    lines.push('```');
    lines.push('');
    lines.push(
      `_این گزارش به صورت خودکار توسط ${this.sanitizeCell(data.preparedBy)} در تاریخ ${data.shamsiDate} تهیه شده است._`,
    );
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate the formal Manager-Ready executive report as print-optimized HTML.
   */
  generateManagerReportHtml(options?: ReporterOptions): string {
    const data = this.getExecutiveData(options);
    const m = data.metrics;
    const active = m.inProgressWorks + m.pendingWorks;
    const e = escapeHtml;

    const worksRows =
      data.works.length === 0
        ? '<tr><td colspan="6" class="empty">کار ثبت‌شده‌ای برای نمایش وجود ندارد.</td></tr>'
        : data.works
            .slice(0, 40)
            .map(
              (w) => `
          <tr>
            <td class="cell-title">${e(w.title)}</td>
            <td>${e(this.workTypeLabel(w.workType))}</td>
            <td><span class="status status-${e(w.status)}">${e(this.workStatusLabel(w.status))}</span></td>
            <td>${e(this.priorityLabel(w.priority))}</td>
            <td>${e(w.leadActor)}</td>
            <td>${this.deliverableReferenceHtml(w)}</td>
          </tr>`,
            )
            .join('');

    const actorsRows =
      data.actors.length === 0
        ? '<tr><td colspan="6" class="empty">عاملی برای نمایش وجود ندارد.</td></tr>'
        : data.actors
            .map(
              (a) => `
          <tr>
            <td class="cell-title">${e(a.name)}</td>
            <td>${e(a.roleLabel)}</td>
            <td>${e(a.type)}</td>
            <td><span class="chip">${e(a.availability)}</span></td>
            <td>${a.totalExecutions}</td>
            <td>${a.successRate}%</td>
          </tr>`,
            )
            .join('');

    const gatesRows = data.qualityGates
      .map(
        (g) => `
          <tr>
            <td class="cell-title">${e(g.name)}</td>
            <td><span class="gate gate-${e(g.status)}">${e(this.gateStatusLabel(g.status))}</span></td>
            <td>${g.total}</td>
            <td>${g.passed}</td>
            <td>${g.failed}</td>
            <td>${e(g.detail)}</td>
          </tr>`,
      )
      .join('');

    const risksRows = data.risks
      .map(
        (r) => `
          <tr>
            <td class="cell-title">${e(r.title)}</td>
            <td><span class="severity severity-${e(r.severity)}">${e(
              this.riskSeverityLabel(r.severity),
            )}</span></td>
            <td>${e(r.impact)}</td>
            <td>${e(r.mitigation)}</td>
          </tr>`,
      )
      .join('');

    const actionItems = data.nextActions.map((a) => `<li>${e(a)}</li>`).join('');

    const approvalItems =
      data.pendingApprovals.length === 0
        ? '<li>موردی در انتظار تأیید مدیریتی وجود ندارد.</li>'
        : data.pendingApprovals
            .map((w) => `<li>${e(w.title)} — ${this.deliverableReferenceHtml(w)}</li>`)
            .join('');

    const completedWorks = data.works.filter((w) => w.status === WorkStatus.COMPLETED);
    const achievementItems =
      completedWorks.length === 0
        ? '<li>مورد شاخصی برای گزارش در بازه فعلی ثبت نشده است.</li>'
        : completedWorks
            .slice(0, 8)
            .map((w) => `<li>${e(w.title)} (${e(this.workTypeLabel(w.workType))})</li>`)
            .join('');

    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>گزارش مدیریتی - ${e(data.reportNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #14213d;
      --muted: #5b6b86;
      --line: #dfe5ee;
      --soft: #f5f7fb;
      --accent: #14428f;
      --accent-soft: #e8eefb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #eef1f6;
      color: var(--ink);
      font-family: "Vazirmatn", "Segoe UI", Tahoma, "Iranian Sans", system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.9;
    }
    .sheet {
      max-width: 900px;
      margin: 24px auto;
      background: #fff;
      padding: 46px 52px;
      box-shadow: 0 8px 30px rgba(20, 33, 61, 0.08);
      border-radius: 6px;
    }
    .toolbar {
      max-width: 900px;
      margin: 16px auto -8px;
      display: flex;
      gap: 10px;
      justify-content: flex-start;
    }
    .toolbar button, .toolbar a {
      font-family: inherit;
      font-size: 13px;
      border: 1px solid var(--accent);
      background: var(--accent);
      color: #fff;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
    }
    .toolbar a.ghost { background: #fff; color: var(--accent); }
    header.report-head {
      border-bottom: 3px solid var(--accent);
      padding-bottom: 18px;
      margin-bottom: 26px;
    }
    .org-name { font-size: 20px; font-weight: 800; letter-spacing: -0.2px; }
    .report-title { font-size: 16px; font-weight: 700; color: var(--accent); margin-top: 4px; }
    .meta-table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 12.5px; }
    .meta-table td { padding: 6px 10px; border: 1px solid var(--line); }
    .meta-table td:first-child { background: var(--soft); font-weight: 600; width: 190px; color: var(--muted); }
    h2 {
      font-size: 15px;
      font-weight: 800;
      margin: 32px 0 12px;
      padding-right: 10px;
      border-right: 4px solid var(--accent);
    }
    p { margin: 8px 0; text-align: justify; }
    ul, ol { margin: 8px 0; padding-right: 22px; }
    li { margin: 4px 0; }
    table.data { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12.5px; }
    table.data th {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 700;
      text-align: right;
      padding: 9px 10px;
      border: 1px solid var(--line);
    }
    table.data td { padding: 8px 10px; border: 1px solid var(--line); vertical-align: top; }
    table.data tr:nth-child(even) td { background: #fbfcfe; }
    .cell-title { font-weight: 600; }
    .empty { text-align: center; color: var(--muted); padding: 16px; }
    .status, .gate, .severity, .chip {
      display: inline-block;
      padding: 1px 9px;
      border-radius: 10px;
      font-size: 11.5px;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .chip { background: var(--soft); border-color: var(--line); color: var(--muted); }
    .status-completed, .gate-pass { background: #e6f4ea; color: #1d7a3d; }
    .status-in_progress { background: #e8eefb; color: #14428f; }
    .status-pending, .gate-warn { background: #fdf3e0; color: #9a6a10; }
    .status-failed, .gate-fail, .severity-high { background: #fbeaea; color: #a32323; }
    .status-blocked { background: #fdf3e0; color: #9a6a10; }
    .status-cancelled { background: #eef1f6; color: #5b6b86; }
    .severity-medium { background: #fdf3e0; color: #9a6a10; }
    .severity-low { background: #e8eefb; color: #14428f; }
    a { color: var(--accent); }
    .mermaid { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 14px; overflow-x: auto; }
    pre.mermaid { margin: 0; direction: ltr; text-align: left; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; white-space: pre; }
    footer.report-foot {
      margin-top: 34px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 11.5px;
    }
    @page { size: A4; margin: 16mm 14mm; }
    @media print {
      body { background: #fff; font-size: 11pt; }
      .no-print { display: none !important; }
      .sheet { margin: 0; padding: 0; box-shadow: none; max-width: none; border-radius: 0; }
      section { page-break-inside: avoid; }
      h2 { page-break-after: avoid; }
      table.data { page-break-inside: auto; }
      table.data tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
      a { color: var(--ink); text-decoration: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <button type="button" onclick="window.print()">چاپ / خروجی PDF</button>
    <a class="ghost" href="/dashboard">بازگشت به داشبورد</a>
    <a class="ghost" href="/report/manager.md">نسخه Markdown</a>
  </div>
  <div class="sheet">
    <header class="report-head">
      <div class="org-name">${e(data.preparedBy)}</div>
      <div class="report-title">گزارش مدیریتی اجرایی تحویل و عملکرد</div>
      <table class="meta-table">
        <tr><td>شماره گزارش</td><td>${e(data.reportNumber)}</td></tr>
        <tr><td>تاریخ (هجری شمسی)</td><td>${e(data.shamsiDateTime)}</td></tr>
        <tr><td>تاریخ (میلادی)</td><td>${e(data.gregorianDateTime)}</td></tr>
        <tr><td>بازه پوشش گزارش</td><td>${e(data.coverageWindow.label)}</td></tr>
        <tr><td>وضعیت کلی</td><td>${e(data.status)}</td></tr>
        <tr><td>تهیه‌کننده</td><td>${e(data.preparedBy)}</td></tr>
      </table>
    </header>

    <section>
      <h2>۱. خلاصه مدیریتی</h2>
      <p>در بازه پوشش این گزارش، سامانه هماهنگی کارخانه نرم‌افزار مجموعاً ${m.totalWorks} کار را مدیریت کرده است که ${m.completedWorks} مورد تکمیل، ${active} مورد در جریان یا در انتظار اجرا و ${m.failedWorks} مورد ناموفق بوده است. نرخ موفقیت اجراهای خودکار ${m.successRate} درصد و سهم اجرای خودکار ${data.automationRate} درصد بوده است.</p>
      <p>برجسته‌ترین دستاوردهای بازه:</p>
      <ul>${achievementItems}</ul>
    </section>

    <section>
      <h2>۲. شاخص‌های کلیدی عملکرد</h2>
      <table class="data">
        <thead><tr><th>شاخص</th><th>مقدار</th><th>توضیح</th></tr></thead>
        <tbody>
          <tr><td>کل کارها</td><td>${m.totalWorks}</td><td>مجموع کارهای ثبت‌شده در بازه</td></tr>
          <tr><td>کارهای تکمیل‌شده</td><td>${m.completedWorks}</td><td>تحویل‌های نهایی‌شده</td></tr>
          <tr><td>کارهای در جریان / در انتظار</td><td>${active}</td><td>چرخه‌های فعال و صف اجرا</td></tr>
          <tr><td>کارهای ناموفق</td><td>${m.failedWorks}</td><td>نیازمند رسیدگی</td></tr>
          <tr><td>کل اجراهای خودکار</td><td>${m.totalExecutions}</td><td>تلاش‌های اجرایی ثبت‌شده</td></tr>
          <tr><td>نرخ موفقیت اجرا</td><td>${m.successRate}%</td><td>نسبت اجراهای موفق</td></tr>
          <tr><td>نرخ خودکارسازی</td><td>${data.automationRate}%</td><td>سهم اجرای عامل‌های خودکار</td></tr>
          <tr><td>عامل‌های فعال</td><td>${m.totalActors}</td><td>انسان و عامل نرم‌افزاری</td></tr>
          <tr><td>سیگنال‌های دریافتی</td><td>${m.totalSignals}</td><td>محرک‌های بیرونی پردازش‌شده</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>۳. وضعیت تحویل قابلیت‌ها و کارها</h2>
      <table class="data">
        <thead><tr><th>قابلیت / کار</th><th>نوع</th><th>وضعیت</th><th>اولویت</th><th>عامل راهبر</th><th>ارجاع</th></tr></thead>
        <tbody>${worksRows}</tbody>
      </table>
    </section>

    <section>
      <h2>۴. بازبینی عملکرد ناوگان عامل‌ها</h2>
      <table class="data">
        <thead><tr><th>عامل</th><th>نقش</th><th>نوع</th><th>آمادگی</th><th>اجرا</th><th>نرخ موفقیت</th></tr></thead>
        <tbody>${actorsRows}</tbody>
      </table>
    </section>

    <section>
      <h2>۵. تضمین کیفیت و دروازه‌های کنترل</h2>
      <table class="data">
        <thead><tr><th>دروازه کنترل</th><th>وضعیت</th><th>تعداد</th><th>موفق</th><th>ناموفق</th><th>توضیح</th></tr></thead>
        <tbody>${gatesRows}</tbody>
      </table>
    </section>

    <section>
      <h2>۶. تحلیل ریسک و گلوگاه‌ها</h2>
      <table class="data">
        <thead><tr><th>ریسک</th><th>شدت</th><th>اثر</th><th>راهکار کاهش</th></tr></thead>
        <tbody>${risksRows}</tbody>
      </table>
    </section>

    <section>
      <h2>۷. اقدامات بعدی و تصمیمات مدیریتی</h2>
      <ol>${actionItems}</ol>
      <p>تحویل‌های در انتظار تأیید مدیریتی:</p>
      <ul>${approvalItems}</ul>
    </section>

    <section>
      <h2>پیوست: نمودار علت و تبار</h2>
      <div class="mermaid">
        <pre class="mermaid">${e(data.lineageMermaid)}</pre>
      </div>
    </section>

    <footer class="report-foot">
      این گزارش به صورت خودکار توسط ${e(data.preparedBy)} در تاریخ ${e(data.shamsiDate)} تهیه شده است.
    </footer>
  </div>
</body>
</html>`;
  }

  private deliverableReferenceHtml(work: ExecutiveWorkItem): string {
    const parts: string[] = [];
    if (work.issueUrl) {
      parts.push(`<a href="${escapeHtml(work.issueUrl)}">شماره ${work.issueNumber ?? ''}</a>`);
    } else if (work.issueNumber) {
      parts.push(`شماره ${work.issueNumber}`);
    }
    if (work.prUrl) {
      parts.push(
        `<a href="${escapeHtml(work.prUrl)}">درخواست ادغام ${work.prNumber ?? ''}</a>`,
      );
    } else if (work.prNumber) {
      parts.push(`درخواست ادغام ${work.prNumber}`);
    }
    return parts.length ? parts.join(' / ') : '---';
  }

  /**
   * Export HTML or Markdown report to file system
   */
  exportReport(
    filePath: string,
    format: 'html' | 'markdown' = 'html',
    options?: ReporterOptions,
  ): string {
    const resolvedPath = path.resolve(filePath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = options?.manager
      ? format === 'markdown'
        ? this.generateManagerReportMarkdown(options)
        : this.generateManagerReportHtml(options)
      : format === 'markdown'
        ? this.generateMarkdownReport(options)
        : this.generateHtmlDashboard(options);

    fs.writeFileSync(resolvedPath, content, 'utf-8');
    this.logger.log(`Exported ${format} report to ${resolvedPath}`);
    return resolvedPath;
  }

  /**
   * Start a lightweight web dashboard HTTP server with SSE support
   */
  async serveDashboard(
    port = 3000,
    host = '0.0.0.0',
  ): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;

        if (pathname === '/' || pathname === '/dashboard' || pathname === '/index.html') {
          const workId = url.searchParams.get('work') || undefined;
          const html = this.generateHtmlDashboard({ workId });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }

        if (pathname === '/report/manager') {
          const workId = url.searchParams.get('work') || undefined;
          const html = this.generateManagerReportHtml({ workId, manager: true });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }

        if (pathname === '/report/manager.md') {
          const workId = url.searchParams.get('work') || undefined;
          const md = this.generateManagerReportMarkdown({ workId, manager: true });
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
          res.end(md);
          return;
        }

        if (pathname === '/api/executive') {
          const workId = url.searchParams.get('work') || undefined;
          const data = this.getExecutiveData({ workId, manager: true });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(data));
          return;
        }

        // Server-Sent Events (SSE) Live Stream endpoint
        if (pathname === '/api/live') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });
          res.write(
            `event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString(), message: 'Connected to Factory Live Stream' })}\n\n`,
          );
          this.sseClients.add(res);
          req.on('close', () => {
            this.sseClients.delete(res);
          });
          return;
        }

        if (pathname === '/api/stats') {
          const metrics = this.getSummaryMetrics();
          const works = this.store.listWorks();
          const actors = this.store.listActors();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ metrics, worksCount: works.length, actorsCount: actors.length }));
          return;
        }

        if (pathname === '/api/lineage') {
          const ref = url.searchParams.get('ref') || '';
          const graph = this.lineageService.getLineage(ref);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(graph));
          return;
        }

        if (pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      });

      server.on('error', (err) => {
        this.logger.error(`Dashboard server error: ${err.message}`);
        reject(err);
      });

      server.listen(port, host, () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        this.logger.log(`Factory Dashboard running at http://${host}:${actualPort}`);
        resolve({
          server,
          port: actualPort,
          close: () =>
            new Promise<void>((closeResolve) => {
              for (const client of this.sseClients) {
                try {
                  client.end();
                } catch {}
              }
              this.sseClients.clear();
              server.close(() => closeResolve());
            }),
        });
      });
    });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
