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
  ExecutionStatus,
  CanonicalUri,
  LineageGraph,
} from '../core';

export interface ReporterOptions {
  workId?: string;
  title?: string;
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

  constructor(
    private readonly store: FactoryStoreService,
    private readonly lineageService: LineageService,
  ) {}

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

    // Signals can be counted via references with signal:// scheme
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
   * Generate a modern, responsive HTML dashboard
   */
  generateHtmlDashboard(options?: ReporterOptions): string {
    const timestamp = new Date().toISOString();
    const metrics = this.getSummaryMetrics();
    const works = this.store.listWorks();
    const actors = this.store.listActors();
    const mermaidGraph = this.toMermaidGraph(options?.workId);

    const title = options?.title || 'Software Factory Dashboard';

    const getStatusBadge = (status: string) => {
      switch (status) {
        case WorkStatus.COMPLETED:
        case ExecutionStatus.COMPLETED:
          return `<span class="badge badge-success">${status}</span>`;
        case WorkStatus.IN_PROGRESS:
        case ExecutionStatus.RUNNING:
          return `<span class="badge badge-primary">${status}</span>`;
        case WorkStatus.PENDING:
          return `<span class="badge badge-warning">${status}</span>`;
        case WorkStatus.FAILED:
        case ExecutionStatus.FAILED:
          return `<span class="badge badge-danger">${status}</span>`;
        default:
          return `<span class="badge badge-neutral">${status}</span>`;
      }
    };

    const worksRows = works
      .map((w) => {
        const execs = this.store.listExecutionsForWork(w.id);
        return `
          <tr>
            <td><strong>${escapeHtml(w.title)}</strong><br/><small class="text-muted">${w.id}</small></td>
            <td>${getStatusBadge(w.status)}</td>
            <td><span class="badge badge-outline">${w.priority}</span></td>
            <td><code>${w.assignedActorId || '-'}</code></td>
            <td>${execs.length}</td>
            <td><small>${w.createdAt.slice(0, 19).replace('T', ' ')}</small></td>
          </tr>
        `;
      })
      .join('');

    const actorsRows = actors
      .map(
        (a) => `
        <tr>
          <td><code>${a.id}</code></td>
          <td><strong>${escapeHtml(a.name)}</strong></td>
          <td><span class="badge badge-outline">${a.type}</span></td>
          <td><span class="badge badge-success">${a.availability}</span></td>
          <td><span class="badge badge-neutral">${a.autonomyLevel}</span></td>
        </tr>
      `,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose' });
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
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 24px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border);
    }
    .header-title h1 { font-size: 24px; font-weight: 600; }
    .header-title p { color: var(--text-muted); font-size: 13px; margin-top: 4px; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
      transition: transform 0.15s ease;
    }
    .kpi-card:hover { transform: translateY(-2px); border-color: var(--primary); }
    .kpi-title { font-size: 13px; color: var(--text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-value { font-size: 32px; font-weight: 700; margin-top: 6px; }
    .kpi-sub { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .card-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    table { width: 100%; border-collapse: collapse; font-size: 14px; text-align: left; }
    th { color: var(--text-muted); font-weight: 600; padding: 12px 14px; border-bottom: 1px solid var(--border); }
    td { padding: 12px 14px; border-bottom: 1px solid rgba(48, 54, 61, 0.5); vertical-align: middle; }
    tr:hover td { background-color: rgba(255, 255, 255, 0.02); }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-success { background: rgba(35, 134, 54, 0.2); color: #3fb950; border: 1px solid rgba(35, 134, 54, 0.4); }
    .badge-primary { background: rgba(88, 166, 255, 0.15); color: #58a6ff; border: 1px solid rgba(88, 166, 255, 0.3); }
    .badge-warning { background: rgba(210, 153, 34, 0.2); color: #d29922; border: 1px solid rgba(210, 153, 34, 0.4); }
    .badge-danger { background: rgba(218, 54, 51, 0.2); color: #f85149; border: 1px solid rgba(218, 54, 51, 0.4); }
    .badge-neutral { background: rgba(139, 148, 158, 0.2); color: #8b949e; }
    .badge-outline { border: 1px solid var(--border); color: var(--text-muted); }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; background: rgba(110, 118, 129, 0.2); padding: 2px 6px; border-radius: 4px; }
    .mermaid-box {
      background: #090d13;
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
      text-align: center;
      min-height: 180px;
    }
    .text-muted { color: var(--text-muted); }
    .btn {
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    .btn:hover { opacity: 0.9; }
    footer { text-align: center; color: var(--text-muted); font-size: 12px; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-title">
        <h1>🏭 ${escapeHtml(title)}</h1>
        <p>Software Factory System of Coordination &bull; Last updated: ${timestamp}</p>
      </div>
      <div>
        <button class="btn" onclick="window.location.reload()">↻ Refresh</button>
      </div>
    </header>

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
        <div class="kpi-title">Registered Actors</div>
        <div class="kpi-value">${metrics.totalActors}</div>
        <div class="kpi-sub">Human + Antigravity (agy) + Claude</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Ingested Signals</div>
        <div class="kpi-value">${metrics.totalSignals}</div>
        <div class="kpi-sub">Telegram &bull; GitHub &bull; CLI</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>🌐 Lineage & Causality Graph</span>
      </div>
      <div class="mermaid-box">
        <pre class="mermaid">
${mermaidGraph}
        </pre>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>📋 Factory Work Items (${works.length})</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Title & ID</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Assigned Actor</th>
            <th>Executions</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${worksRows || '<tr><td colspan="6" style="text-align:center; padding:24px;">No work items registered</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-title">
        <span>🤖 Configured Actors (${actors.length})</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Type</th>
            <th>Availability</th>
            <th>Autonomy Level</th>
          </tr>
        </thead>
        <tbody>
          ${actorsRows}
        </tbody>
      </table>
    </div>

    <footer>
      Software Factory (Concept v31) &bull; Coordinates Humans, Agents & External Systems
    </footer>
  </div>
</body>
</html>`;
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

    const content =
      format === 'markdown'
        ? this.generateMarkdownReport(options)
        : this.generateHtmlDashboard(options);

    fs.writeFileSync(resolvedPath, content, 'utf-8');
    this.logger.log(`Exported ${format} report to ${resolvedPath}`);
    return resolvedPath;
  }

  /**
   * Start a lightweight web dashboard HTTP server
   */
  async serveDashboard(
    port = 3000,
    host = '0.0.0.0',
  ): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;

        if (pathname === '/' || pathname === '/index.html') {
          const workId = url.searchParams.get('work') || undefined;
          const html = this.generateHtmlDashboard({ workId });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
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
