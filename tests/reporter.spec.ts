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
    it('should generate valid standalone HTML dashboard with dark styling and Mermaid', () => {
      const html = reporterService.generateHtmlDashboard();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Software Factory Dashboard</title>');
      expect(html).toContain('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs');
      expect(html).toContain('Total Works');
      expect(html).toContain('Setup Core Database');
      expect(html).toContain('Lineage Graph Dashboard');
      expect(html).toContain('badge-success');
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

  describe('serveDashboard', () => {
    it('should serve HTML dashboard and JSON API via HTTP', async () => {
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

        // Test GET /404
        const notFoundRes = await fetchUrl('/random-endpoint');
        expect(notFoundRes.status).toBe(404);
      } finally {
        await serverInstance.close();
      }
    });
  });
});
