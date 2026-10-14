import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DoctorService, DoctorReport } from '../src/engine/doctor.service';
import { ConfigLoaderService } from '../src/config';
import { DatabaseService } from '../src/store';

describe('DoctorService', () => {
  let tempDir: string;
  let dbService: DatabaseService;
  let configLoader: ConfigLoaderService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-doctor-test-'));
    dbService = new DatabaseService(':memory:');
    dbService.connect();
    configLoader = new ConfigLoaderService(tempDir);
  });

  afterEach(() => {
    dbService.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Integrated Diagnostics', () => {
    it('should run full diagnostics on real environment and return structured report', async () => {
      const doctor = new DoctorService(configLoader, dbService);
      const report: DoctorReport = await doctor.runDiagnostics({
        cwd: process.cwd(),
      });

      expect(report.timestamp).toBeDefined();
      expect(['OK', 'WARN', 'FAIL']).toContain(report.overallStatus);
      expect(report.checks.length).toBe(10);
      expect(report.summary.total).toBe(10);
      expect(report.summary.ok + report.summary.warn + report.summary.fail).toBe(10);

      // Verify category assignments
      const categories = report.checks.map((c) => c.category);
      expect(categories).toContain('runtime');
      expect(categories).toContain('git');
      expect(categories).toContain('gateway');
      expect(categories).toContain('agents');
      expect(categories).toContain('config');
      expect(categories).toContain('storage');
    });

    it('should skip network checks when skipNetwork is true', async () => {
      const doctor = new DoctorService(configLoader, dbService);
      const report = await doctor.runDiagnostics({
        cwd: tempDir,
        skipNetwork: true,
      });

      const routerCheck = report.checks.find((c) => c.id === 'router_connectivity');
      const proxyCheck = report.checks.find((c) => c.id === 'antigravity_proxy');

      expect(routerCheck?.message).toContain('skipNetwork');
      expect(proxyCheck?.message).toContain('skipNetwork');
    });

    it('should format diagnostic report with clear badges and summary', async () => {
      const doctor = new DoctorService(configLoader, dbService);
      const report = await doctor.runDiagnostics({ skipNetwork: true });
      const formatted = doctor.formatReport(report);

      expect(formatted).toContain('Software Factory System & Environment Doctor');
      expect(formatted).toContain('Overall Status:');
      expect(formatted).toContain('Summary: 10 total');
    });
  });

  describe('Individual Diagnostic Checks', () => {
    describe('Node.js Version Check', () => {
      it('should report OK for Node version >= 24', () => {
        const doctor = new DoctorService();
        const check = doctor.checkNodeVersion();
        const major = parseInt(process.version.slice(1).split('.')[0], 10);

        if (major >= 24) {
          expect(check.status).toBe('OK');
          expect(check.message).toContain('v24+');
        } else if (major >= 20) {
          expect(check.status).toBe('WARN');
        } else {
          expect(check.status).toBe('FAIL');
        }
      });
    });

    describe('pnpm Version Check', () => {
      it('should return OK when pnpm is installed', () => {
        const doctor = new DoctorService(undefined, undefined, {
          execFn: () => '12.5.0\n',
        });
        const check = doctor.checkPnpmVersion();
        expect(check.status).toBe('OK');
        expect(check.message).toContain('12.5.0');
      });

      it('should return WARN with actionable fix when pnpm is missing', () => {
        const doctor = new DoctorService(undefined, undefined, {
          execFn: () => {
            throw new Error('pnpm: command not found');
          },
        });
        const check = doctor.checkPnpmVersion();
        expect(check.status).toBe('WARN');
        expect(check.fix).toContain('npm install -g pnpm');
      });
    });

    describe('Git Status Check', () => {
      it('should return FAIL when git CLI is not installed', () => {
        const doctor = new DoctorService(undefined, undefined, {
          execFn: () => {
            throw new Error('git: command not found');
          },
        });
        const check = doctor.checkGitStatus(tempDir);
        expect(check.status).toBe('FAIL');
        expect(check.fix).toContain('Install Git');
      });

      it('should return WARN when directory is not inside a git repository', () => {
        const doctor = new DoctorService(undefined, undefined, {
          execFn: (cmd: string) => {
            if (cmd === 'git --version') return 'git version 2.40.0';
            if (cmd.includes('rev-parse --is-inside-work-tree')) return 'false';
            return '';
          },
        });
        const check = doctor.checkGitStatus(tempDir);
        expect(check.status).toBe('WARN');
        expect(check.fix).toContain('git init');
      });

      it('should return OK when inside clean git repository', () => {
        const doctor = new DoctorService(undefined, undefined, {
          execFn: (cmd: string) => {
            if (cmd === 'git --version') return 'git version 2.40.0';
            if (cmd.includes('rev-parse --is-inside-work-tree')) return 'true';
            if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'main';
            if (cmd.includes('status --porcelain')) return '';
            return '';
          },
        });
        const check = doctor.checkGitStatus(tempDir);
        expect(check.status).toBe('OK');
        expect(check.message).toContain('working tree clean');
      });

      it('should report uncommitted changes when working tree is dirty', () => {
        const doctor = new DoctorService(undefined, undefined, {
          execFn: (cmd: string) => {
            if (cmd === 'git --version') return 'git version 2.40.0';
            if (cmd.includes('rev-parse --is-inside-work-tree')) return 'true';
            if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'feature/test';
            if (cmd.includes('status --porcelain')) return ' M file1.ts\n?? file2.ts';
            return '';
          },
        });
        const check = doctor.checkGitStatus(tempDir);
        expect(check.status).toBe('OK');
        expect(check.message).toContain('2 uncommitted changes');
      });
    });

    describe('GitHub CLI Auth Check', () => {
      it('should return WARN when gh CLI is missing', () => {
        const doctor = new DoctorService(undefined, undefined, {
          execFn: () => {
            throw new Error('gh: command not found');
          },
        });
        const check = doctor.checkGitHubAuth(tempDir);
        expect(check.status).toBe('WARN');
        expect(check.fix).toContain('Install GitHub CLI');
      });

      it('should return OK when gh is authenticated with account name', () => {
        const doctor = new DoctorService(undefined, undefined, {
          execFn: (cmd: string) => {
            if (cmd === 'gh --version') return 'gh version 2.60.0';
            if (cmd.includes('auth status')) {
              return '✓ Logged in to github.com account test-user (keyring)\n';
            }
            return '';
          },
        });
        const check = doctor.checkGitHubAuth(tempDir);
        expect(check.status).toBe('OK');
        expect(check.message).toContain('test-user');
      });

      it('should return WARN with actionable fix when gh is not logged in', () => {
        const doctor = new DoctorService(undefined, undefined, {
          execFn: (cmd: string) => {
            if (cmd === 'gh --version') return 'gh version 2.60.0';
            if (cmd.includes('auth status')) {
              throw new Error('You are not logged into any GitHub hosts.');
            }
            return '';
          },
        });
        const check = doctor.checkGitHubAuth(tempDir);
        expect(check.status).toBe('WARN');
        expect(check.fix).toContain('gh auth login');
      });
    });

    describe('9Router Gateway Check', () => {
      it('should return OK when 9Router responds with model list', async () => {
        const mockFetch: typeof fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'model-1' }, { id: 'model-2' }] }),
        } as any);

        const doctor = new DoctorService(undefined, undefined, {
          fetchFn: mockFetch,
        });

        const check = await doctor.check9RouterConnectivity('http://localhost:20128/v1/models', 1000);
        expect(check.status).toBe('OK');
        expect(check.message).toContain('2 models available');
      });

      it('should return WARN when 9Router Gateway is unreachable', async () => {
        const mockFetch: typeof fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

        const doctor = new DoctorService(undefined, undefined, {
          fetchFn: mockFetch,
        });

        const check = await doctor.check9RouterConnectivity('http://localhost:20128/v1/models', 1000);
        expect(check.status).toBe('WARN');
        expect(check.fix).toContain('Start 9Router Gateway');
      });
    });

    describe('Antigravity Proxy Check', () => {
      it('should return OK when socket connection succeeds', async () => {
        const doctor = new DoctorService(undefined, undefined, {
          socketProbeFn: async () => true,
        });

        const check = await doctor.checkAntigravityProxy('127.0.0.1', 10808, 1000);
        expect(check.status).toBe('OK');
        expect(check.message).toContain('127.0.0.1:10808');
      });

      it('should return WARN with fix when socket connection fails', async () => {
        const doctor = new DoctorService(undefined, undefined, {
          socketProbeFn: async () => false,
        });

        const check = await doctor.checkAntigravityProxy('127.0.0.1', 10808, 1000);
        expect(check.status).toBe('WARN');
        expect(check.fix).toContain('port 10808');
      });
    });

    describe('Factory Config Check', () => {
      it('should return OK when factory.yaml is valid', () => {
        const yamlContent = `
name: valid-factory
version: 1.0.0
`;
        fs.writeFileSync(path.join(tempDir, 'factory.yaml'), yamlContent, 'utf-8');

        const doctor = new DoctorService(new ConfigLoaderService(tempDir));
        const check = doctor.checkFactoryConfig(tempDir);
        expect(check.status).toBe('OK');
        expect(check.message).toContain('valid-factory');
      });

      it('should return FAIL when factory.yaml contains syntax or schema errors', () => {
        const invalidYaml = `
name: 12345
actors: invalid
`;
        fs.writeFileSync(path.join(tempDir, 'factory.yaml'), invalidYaml, 'utf-8');

        const doctor = new DoctorService(new ConfigLoaderService(tempDir));
        const check = doctor.checkFactoryConfig(tempDir);
        expect(check.status).toBe('FAIL');
        expect(check.fix).toBeDefined();
      });

      it('should return WARN when factory.yaml does not exist', () => {
        const doctor = new DoctorService(new ConfigLoaderService(tempDir));
        const check = doctor.checkFactoryConfig(tempDir);
        expect(check.status).toBe('WARN');
        expect(check.fix).toContain('factory init');
      });
    });

    describe('Database Storage Check', () => {
      it('should return OK when SQLite read/write succeeds', () => {
        const doctor = new DoctorService(undefined, dbService);
        const check = doctor.checkDatabase(tempDir);
        expect(check.status).toBe('OK');
        expect(check.message).toContain('operational');
      });

      it('should return FAIL when database directory is invalid or unwritable', () => {
        const doctor = new DoctorService();
        // Create a regular file so mkdirSync as directory will fail with ENOTDIR
        const blockedFile = path.join(tempDir, 'blocked-file');
        fs.writeFileSync(blockedFile, 'cannot-be-directory');
        const check = doctor.checkDatabase(tempDir, path.join(blockedFile, 'factory.db'));
        expect(check.status).toBe('FAIL');
        expect(check.fix).toBeDefined();
      });
    });

    describe('Report Actionable Fixes Formatting', () => {
      it('should include actionable fixes section when warnings or failures are present', () => {
        const doctor = new DoctorService();
        const mockReport: DoctorReport = {
          timestamp: new Date().toISOString(),
          overallStatus: 'FAIL',
          checks: [
            {
              id: 'node_version',
              name: 'Node.js',
              category: 'runtime',
              status: 'FAIL',
              message: 'Outdated version',
              fix: 'Upgrade Node.js to v24',
            },
            {
              id: 'router',
              name: '9Router',
              category: 'gateway',
              status: 'WARN',
              message: 'Unreachable',
              fix: 'Start 9router on port 20128',
            },
          ],
          summary: { total: 2, ok: 0, warn: 1, fail: 1 },
        };

        const formatted = doctor.formatReport(mockReport);
        expect(formatted).toContain('FAILURES DETECTED');
        expect(formatted).toContain('Actionable Fixes & Recommendations:');
        expect(formatted).toContain('Upgrade Node.js to v24');
        expect(formatted).toContain('Start 9router on port 20128');
      });
    });
  });
});
