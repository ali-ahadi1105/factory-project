import { DatabaseService, FactoryStoreService } from '../src/store';
import { LineageService, ReporterService } from '../src/engine';
import { WorkStatus, WorkType, WorkPriority, ExecutionStatus } from '../src/core';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('ReporterService', () => {
  let dbService: DatabaseService;
  let store: FactoryStoreService;
  let lineageService: LineageService;
  let reporterService: ReporterService;

  beforeEach(() => {
    dbService = new DatabaseService(':memory:');
    dbService.connect();
    store = new FactoryStoreService(dbService);
    lineageService = new LineageService(store);
    reporterService = new ReporterService(store, lineageService);

    // Seed dummy actors
    store.saveActor({
      id: 'human:ali',
      name: 'Ali (Gate)',
      type: 'human' as any,
      adapterType: 'manual' as any,
      capabilities: ['approval'],
      availability: 'available' as any,
      autonomyLevel: 'human_only' as any,
      config: {},
      createdAt: new Date().toISOString(),
    });

    store.saveActor({
      id: 'agy',
      name: 'Google Antigravity Agent',
      type: 'internal_agent' as any,
      adapterType: 'cli' as any,
      capabilities: ['code_generation'],
      availability: 'available' as any,
      autonomyLevel: 'semi_autonomous' as any,
      config: {},
      createdAt: new Date().toISOString(),
    });

    // Seed dummy works
    const now = new Date().toISOString();
    store.saveWork({
      id: 'work-1',
      title: 'Setup Core Database',
      description: 'Implement SQLite WAL mode and foreign keys',
      type: WorkType.IMPLEMENTATION,
      status: WorkStatus.COMPLETED,
      priority: WorkPriority.HIGH,
      assignedActorId: 'agy',
      context: {},
      createdAt: now,
      updatedAt: now,
    });

    store.saveWork({
      id: 'work-2',
      title: 'Lineage Graph Dashboard',
      description: 'Build HTML and Markdown reporters',
      type: WorkType.IMPLEMENTATION,
      status: WorkStatus.IN_PROGRESS,
      priority: WorkPriority.CRITICAL,
      assignedActorId: 'agy',
      context: {},
      createdAt: now,
      updatedAt: now,
    });

    // Seed executions
    store.saveExecution({
      id: 'exec-1',
      workId: 'work-1',
      actorId: 'agy',
      status: ExecutionStatus.COMPLETED,
      correlationId: 'corr-1',
      causationId: 'signal-1',
      logs: 'Running sqlite setup... All migrations passed.',
      producedReferences: ['git://commit/88d2038'],
      startedAt: now,
      finishedAt: now,
    });

    // Seed relations
    store.saveRelation({
      id: 'rel-1',
      sourceRef: 'factory://work/work-1',
      targetRef: 'agent://agy/run/exec-1',
      relationType: 'performed-by' as any,
      metadata: {},
      createdAt: now,
    });

    store.saveRelation({
      id: 'rel-2',
      sourceRef: 'agent://agy/run/exec-1',
      targetRef: 'git://commit/88d2038',
      relationType: 'produced' as any,
      metadata: {},
      createdAt: now,
    });
  });

  afterEach(() => {
    dbService.close();
  });

  describe('getSummaryMetrics', () => {
    it('should calculate accurate factory metrics', () => {
      const metrics = reporterService.getSummaryMetrics();
      expect(metrics.totalWorks).toBe(2);
      expect(metrics.completedWorks).toBe(1);
      expect(metrics.inProgressWorks).toBe(1);
      expect(metrics.pendingWorks).toBe(0);
      expect(metrics.totalExecutions).toBe(1);
      expect(metrics.successfulExecutions).toBe(1);
      expect(metrics.successRate).toBe(100);
      expect(metrics.totalActors).toBe(2);
    });
  });

  describe('generateMarkdownReport', () => {
    it('should generate full factory Markdown report', () => {
      const md = reporterService.generateMarkdownReport();
      expect(md).toContain('# 🏭 Software Factory Status & Lineage Report');
      expect(md).toContain('Total Works');
      expect(md).toContain('Setup Core Database');
      expect(md).toContain('Lineage Graph Dashboard');
      expect(md).toContain('Google Antigravity Agent');
      expect(md).toContain('```mermaid');
    });

    it('should generate specific work lineage Markdown report', () => {
      const md = reporterService.generateMarkdownReport({ workId: 'work-1' });
      expect(md).toContain('# Software Factory Lineage Report: Setup Core Database');
      expect(md).toContain('Execution #1 (exec-1)');
      expect(md).toContain('git://commit/88d2038');
      expect(md).toContain('All migrations passed.');
      expect(md).toContain('Lineage ASCII Tree');
      expect(md).toContain('```mermaid');
    });

    it('should handle non-existent work gracefully', () => {
      const md = reporterService.generateMarkdownReport({ workId: 'unknown-work' });
      expect(md).toContain('Work ID `unknown-work` does not exist');
    });
  });

  describe('generateHtmlDashboard', () => {
    it('should generate valid standalone HTML dashboard with dark styling, Mermaid and Live terminal', () => {
      const html = reporterService.generateHtmlDashboard();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Software Factory Dashboard</title>');
      expect(html).toContain('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs');
      expect(html).toContain('Live Execution Stream & Logs');
      expect(html).toContain('id="terminal-logs"');
      expect(html).toContain('/api/live');
      expect(html).toContain('Total Works');
      expect(html).toContain('Setup Core Database');
      expect(html).toContain('Lineage Graph Dashboard');
      expect(html).toContain('badge-success');
    });

    it('should expose the six executive tabs with SSE streaming, exports and print styling', () => {
      const html = reporterService.generateHtmlDashboard();

      // Six executive tabs: Overview, Deliverables, Agent Fleet, Manager Report, Live Console, Lineage
      const tabIds = ['overview', 'deliverables', 'fleet', 'manager', 'console', 'lineage'];
      for (const tab of tabIds) {
        expect(html).toContain(`data-tab="${tab}"`);
        expect(html).toContain(`id="tab-${tab}"`);
      }
      expect((html.match(/data-tab=/g) || []).length).toBe(6);
      expect((html.match(/class="tab-pane/g) || []).length).toBe(6);

      // Real-time SSE streaming, quick exports and print-optimized CSS
      expect(html).toContain('/api/live');
      expect(html).toContain('new EventSource');
      expect(html).toContain('/report/manager.md');
      expect(html).toContain('@media print');
      expect(html).toContain('factoryToggleTheme');
      expect(html).toContain('factoryPrintReport');

      // Executive sample data is rendered on the Overview tab
      expect(html).toContain('Total Works');
      expect(html).toContain('Automation Rate');
    });
  });

  describe('exportReport', () => {
    it('should export HTML and Markdown files to disk', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-test-'));
      const htmlPath = path.join(tempDir, 'dashboard.html');
      const mdPath = path.join(tempDir, 'report.md');

      const exportedHtml = reporterService.exportReport(htmlPath, 'html');
      const exportedMd = reporterService.exportReport(mdPath, 'markdown');

      expect(fs.existsSync(exportedHtml)).toBe(true);
      expect(fs.existsSync(exportedMd)).toBe(true);

      const htmlContent = fs.readFileSync(exportedHtml, 'utf-8');
      const mdContent = fs.readFileSync(exportedMd, 'utf-8');

      expect(htmlContent).toContain('<!DOCTYPE html>');
      expect(mdContent).toContain('# 🏭 Software Factory Status & Lineage Report');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('serveDashboard & SSE /api/live', () => {
    it('should serve HTML dashboard, JSON API, and SSE live stream via HTTP', async () => {
      const serverInstance = await reporterService.serveDashboard(0, '127.0.0.1');
      const port = serverInstance.port;
      expect(port).toBeGreaterThan(0);

      const fetchUrl = (urlPath: string): Promise<{ status: number; contentType?: string; body: string }> => {
        return new Promise((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
              let data = '';
              res.on('data', (chunk) => (data += chunk));
              res.on('end', () =>
                resolve({
                  status: res.statusCode || 0,
                  contentType: res.headers['content-type'],
                  body: data,
                }),
              );
            })
            .on('error', reject);
        });
      };

      try {
        // Test GET /
        const rootRes = await fetchUrl('/');
        expect(rootRes.status).toBe(200);
        expect(rootRes.contentType).toContain('text/html');
        expect(rootRes.body).toContain('Software Factory Dashboard');
        expect(rootRes.body).toContain('terminal-logs');

        // Test GET /api/stats
        const statsRes = await fetchUrl('/api/stats');
        expect(statsRes.status).toBe(200);
        expect(statsRes.contentType).toContain('application/json');
        const statsJson = JSON.parse(statsRes.body);
        expect(statsJson.metrics.totalWorks).toBe(2);
        expect(statsJson.metrics.totalActors).toBe(2);

        // Test GET /health
        const healthRes = await fetchUrl('/health');
        expect(healthRes.status).toBe(200);
        expect(JSON.parse(healthRes.body).status).toBe('ok');

        // Test SSE stream /api/live
        const sseEvents: string[] = [];
        const sseReq = http.get(`http://127.0.0.1:${port}/api/live`, (res) => {
          expect(res.headers['content-type']).toBe('text/event-stream');
          res.on('data', (chunk) => {
            sseEvents.push(chunk.toString());
          });
        });

        // Wait brief tick for SSE connection to register
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(reporterService.getActiveSseClientCount()).toBe(1);

        // Broadcast events
        reporterService.broadcastLog('agy', 'Code generator started.');
        reporterService.broadcastProgress('implement', 'in_progress', 'Generating tests');

        await new Promise((resolve) => setTimeout(resolve, 50));

        const fullStream = sseEvents.join('');
        expect(fullStream).toContain('event: connected');
        expect(fullStream).toContain('event: log');
        expect(fullStream).toContain('Code generator started.');
        expect(fullStream).toContain('event: progress');
        expect(fullStream).toContain('Generating tests');

        sseReq.destroy();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(reporterService.getActiveSseClientCount()).toBe(0);
      } finally {
        await serverInstance.close();
      }
    });

    it('should serve manager report HTML, Markdown, and executive JSON endpoints', async () => {
      const serverInstance = await reporterService.serveDashboard(0, '127.0.0.1');
      const port = serverInstance.port;

      const fetchUrl = (urlPath: string): Promise<{ status: number; contentType?: string; body: string }> => {
        return new Promise((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
              let data = '';
              res.on('data', (chunk) => (data += chunk));
              res.on('end', () =>
                resolve({
                  status: res.statusCode || 0,
                  contentType: res.headers['content-type'],
                  body: data,
                }),
              );
            })
            .on('error', reject);
        });
      };

      try {
        // Test GET /dashboard alias
        const dashRes = await fetchUrl('/dashboard');
        expect(dashRes.status).toBe(200);
        expect(dashRes.contentType).toContain('text/html');
        expect(dashRes.body).toContain('Software Factory Dashboard');

        // Test GET /report/manager
        const mgrHtmlRes = await fetchUrl('/report/manager');
        expect(mgrHtmlRes.status).toBe(200);
        expect(mgrHtmlRes.contentType).toContain('text/html');
        expect(mgrHtmlRes.body).toContain('گزارش مدیریتی');
        expect(mgrHtmlRes.body).toContain('خلاصه مدیریتی');
        expect(mgrHtmlRes.body).toContain('window.print()');

        // Test GET /report/manager.md
        const mgrMdRes = await fetchUrl('/report/manager.md');
        expect(mgrMdRes.status).toBe(200);
        expect(mgrMdRes.contentType).toContain('text/markdown');
        expect(mgrMdRes.body).toContain('# گزارش مدیریتی سامانه هماهنگی کارخانه نرم‌افزار');
        expect(mgrMdRes.body).toContain('## ۱. خلاصه مدیریتی');

        // Test GET /api/executive
        const execRes = await fetchUrl('/api/executive');
        expect(execRes.status).toBe(200);
        expect(execRes.contentType).toContain('application/json');
        const execJson = JSON.parse(execRes.body);
        expect(execJson.reportNumber).toBeDefined();
        expect(execJson.shamsiDate).toBeDefined();
        expect(execJson.gregorianDate).toBeDefined();
        expect(execJson.metrics.totalWorks).toBe(2);
        expect(Array.isArray(execJson.works)).toBe(true);
        expect(Array.isArray(execJson.actors)).toBe(true);
        expect(Array.isArray(execJson.qualityGates)).toBe(true);
        expect(Array.isArray(execJson.risks)).toBe(true);
      } finally {
        await serverInstance.close();
      }
    });
  });

  describe('getExecutiveData & Manager Report generation', () => {
    it('should aggregate complete executive data with Persian dual dates and metrics', () => {
      const data = reporterService.getExecutiveData();
      expect(data.reportNumber).toMatch(/^SF-EXEC-/);
      expect(data.preparedBy).toContain('سامانه هماهنگی کارخانه نرم‌افزار');
      expect(data.shamsiDate).toBeDefined();
      expect(data.gregorianDate).toBeDefined();
      expect(data.shamsiDateTime).toBeDefined();
      expect(data.gregorianDateTime).toBeDefined();
      expect(data.coverageWindow).toBeDefined();
      expect(data.coverageWindow.label).toContain('از');
      expect(data.metrics.totalWorks).toBe(2);
      expect(data.metrics.completedWorks).toBe(1);
      expect(data.metrics.inProgressWorks).toBe(1);
      expect(data.automationRate).toBeGreaterThanOrEqual(0);
      expect(data.works.length).toBe(2);
      expect(data.actors.length).toBe(2);
      expect(data.qualityGates.length).toBeGreaterThan(0);
      expect(data.risks.length).toBeGreaterThan(0);
      expect(data.nextActions.length).toBeGreaterThan(0);
      expect(data.lineageMermaid).toContain('graph TD');
    });

    it('should generate formal Persian manager Markdown report', () => {
      const md = reporterService.generateManagerReportMarkdown();
      expect(md).toContain('# گزارش مدیریتی سامانه هماهنگی کارخانه نرم‌افزار');
      expect(md).toContain('## ۱. خلاصه مدیریتی');
      expect(md).toContain('## ۲. شاخص‌های کلیدی عملکرد');
      expect(md).toContain('## ۳. وضعیت تحویل قابلیت‌ها و کارها');
      expect(md).toContain('## ۴. بازبینی عملکرد ناوگان عامل‌ها');
      expect(md).toContain('## ۵. تضمین کیفیت و دروازه‌های کنترل');
      expect(md).toContain('## ۶. تحلیل ریسک و گلوگاه‌ها');
      expect(md).toContain('## ۷. اقدامات بعدی و تصمیمات مدیریتی');
      expect(md).toContain('## پیوست: نمودار علت و تبار');
      expect(md).toContain('```mermaid');
      expect(md).toContain('Setup Core Database');
    });

    it('should generate formal Persian manager HTML report with RTL, Vazirmatn and print styling', () => {
      const html = reporterService.generateManagerReportHtml();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('lang="fa"');
      expect(html).toContain('Vazirmatn');
      expect(html).toContain('گزارش مدیریتی');
      expect(html).toContain('@media print');
      expect(html).toContain('window.print()');
      expect(html).toContain('Setup Core Database');
      expect(html).toContain('Lineage Graph Dashboard');
    });

    it('should export manager reports when manager option is enabled', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-mgr-test-'));
      const htmlPath = path.join(tempDir, 'manager.html');
      const mdPath = path.join(tempDir, 'manager.md');

      const exportedHtml = reporterService.exportReport(htmlPath, 'html', { manager: true });
      const exportedMd = reporterService.exportReport(mdPath, 'markdown', { manager: true });

      expect(fs.existsSync(exportedHtml)).toBe(true);
      expect(fs.existsSync(exportedMd)).toBe(true);

      const htmlContent = fs.readFileSync(exportedHtml, 'utf-8');
      const mdContent = fs.readFileSync(exportedMd, 'utf-8');

      expect(htmlContent).toContain('گزارش مدیریتی');
      expect(htmlContent).toContain('dir="rtl"');
      expect(mdContent).toContain('# گزارش مدیریتی سامانه هماهنگی کارخانه نرم‌افزار');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
