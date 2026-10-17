import { Injectable, Logger, Optional } from '@nestjs/common';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import * as os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { ConfigLoaderService } from '../config';
import { DatabaseService } from '../store';

export type CheckStatus = 'OK' | 'WARN' | 'FAIL';

export interface DiagnosticCheck {
  id: string;
  name: string;
  category: 'runtime' | 'git' | 'gateway' | 'agents' | 'config' | 'storage';
  status: CheckStatus;
  message: string;
  details?: Record<string, any>;
  fix?: string;
}

export interface DoctorReport {
  timestamp: string;
  overallStatus: CheckStatus;
  checks: DiagnosticCheck[];
  summary: {
    total: number;
    ok: number;
    warn: number;
    fail: number;
  };
}

export interface DoctorRunOptions {
  cwd?: string;
  configPath?: string;
  dbPath?: string;
  timeoutMs?: number;
  routerUrl?: string;
  proxyHost?: string;
  proxyPort?: number;
  skipNetwork?: boolean;
}

export interface DoctorServiceInjections {
  execFn?: (cmd: string, options?: any) => string;
  fetchFn?: typeof fetch;
  socketProbeFn?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
}

@Injectable()
export class DoctorService {
  private readonly logger = new Logger(DoctorService.name);
  private execFn: (cmd: string, options?: any) => string;
  private fetchFn: typeof fetch;
  private socketProbeFn: (host: string, port: number, timeoutMs: number) => Promise<boolean>;

  constructor(
    @Optional() private readonly configLoader?: ConfigLoaderService,
    @Optional() private readonly dbService?: DatabaseService,
    @Optional() customInjections?: DoctorServiceInjections,
  ) {
    this.execFn =
      customInjections?.execFn ||
      ((cmd: string, options?: any) => child_process.execSync(cmd, options).toString());
    this.fetchFn = customInjections?.fetchFn || globalThis.fetch;
    this.socketProbeFn = customInjections?.socketProbeFn || this.defaultSocketProbe.bind(this);
  }

  private defaultSocketProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(true);
        }
      });

      socket.on('timeout', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(false);
        }
      });

      socket.on('error', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(false);
        }
      });

      try {
        socket.connect(port, host);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Run comprehensive diagnostics on the system and environment
   */
  async runDiagnostics(options: DoctorRunOptions = {}): Promise<DoctorReport> {
    const cwd = options.cwd || process.cwd();
    const timeoutMs = options.timeoutMs ?? 2000;
    const checks: DiagnosticCheck[] = [];

    // 1. Node.js runtime version
    checks.push(this.checkNodeVersion());

    // 2. pnpm version
    checks.push(this.checkPnpmVersion(cwd));

    // 3. Git status & repository
    checks.push(this.checkGitStatus(cwd));

    // 4. GitHub CLI auth status
    checks.push(this.checkGitHubAuth(cwd));

    // 5. 9Router Gateway connectivity
    if (options.skipNetwork) {
      checks.push({
        id: 'router_connectivity',
        name: '9Router Gateway',
        category: 'gateway',
        status: 'OK',
        message: '9Router Gateway check skipped (skipNetwork enabled)',
      });
    } else {
      checks.push(
        await this.check9RouterConnectivity(
          options.routerUrl || 'http://localhost:20128/v1/models',
          timeoutMs,
        ),
      );
    }

    // 6. Antigravity Proxy readiness
    if (options.skipNetwork) {
      checks.push({
        id: 'antigravity_proxy',
        name: 'Antigravity Proxy',
        category: 'gateway',
        status: 'OK',
        message: 'Antigravity Proxy check skipped (skipNetwork enabled)',
      });
    } else {
      checks.push(
        await this.checkAntigravityProxy(
          options.proxyHost || '127.0.0.1',
          options.proxyPort ?? 10808,
          timeoutMs,
        ),
      );
    }

    // 7. agy CLI binary
    checks.push(this.checkAgyCli());

    // 8. opencode CLI binary
    checks.push(this.checkOpencodeCli());

    // 9. claude CLI binary & settings
    checks.push(this.checkClaudeCli());

    // 9. factory.yaml configuration validity
    checks.push(this.checkFactoryConfig(cwd, options.configPath));

    // 10. SQLite Database read/write access
    checks.push(this.checkDatabase(cwd, options.dbPath));

    // Calculate summary & overall status
    let ok = 0;
    let warn = 0;
    let fail = 0;

    for (const c of checks) {
      if (c.status === 'OK') ok++;
      else if (c.status === 'WARN') warn++;
      else if (c.status === 'FAIL') fail++;
    }

    const overallStatus: CheckStatus = fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : 'OK';

    return {
      timestamp: new Date().toISOString(),
      overallStatus,
      checks,
      summary: {
        total: checks.length,
        ok,
        warn,
        fail,
      },
    };
  }

  /**
   * Check Node.js version (v24+ recommended, v20+ supported)
   */
  checkNodeVersion(): DiagnosticCheck {
    const rawVersion = process.version;
    const match = rawVersion.match(/^v(\d+)\.(\d+)\.(\d+)/);
    const major = match ? parseInt(match[1], 10) : 0;

    if (major >= 24) {
      return {
        id: 'node_version',
        name: 'Node.js Runtime',
        category: 'runtime',
        status: 'OK',
        message: `Node.js ${rawVersion} (v24+ active runtime)`,
        details: { version: rawVersion, major },
      };
    } else if (major >= 20) {
      return {
        id: 'node_version',
        name: 'Node.js Runtime',
        category: 'runtime',
        status: 'WARN',
        message: `Node.js ${rawVersion} detected (v24+ recommended by Concept v31)`,
        details: { version: rawVersion, major },
        fix: 'Upgrade Node.js to v24 or later for optimal performance and native SQLite support.',
      };
    } else {
      return {
        id: 'node_version',
        name: 'Node.js Runtime',
        category: 'runtime',
        status: 'FAIL',
        message: `Node.js ${rawVersion} is unsupported (v24+ required)`,
        details: { version: rawVersion, major },
        fix: 'Upgrade Node.js to v24 or later.',
      };
    }
  }

  /**
   * Check pnpm package manager
   */
  checkPnpmVersion(cwd?: string): DiagnosticCheck {
    try {
      const output = this.execFn('pnpm --version', {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return {
        id: 'pnpm_version',
        name: 'pnpm Package Manager',
        category: 'runtime',
        status: 'OK',
        message: `pnpm v${output} installed`,
        details: { version: output },
      };
    } catch (err: any) {
      return {
        id: 'pnpm_version',
        name: 'pnpm Package Manager',
        category: 'runtime',
        status: 'WARN',
        message: 'pnpm is not installed or not available in PATH',
        details: { error: err.message },
        fix: 'Install pnpm globally: npm install -g pnpm',
      };
    }
  }

  /**
   * Check Git repository and status
   */
  checkGitStatus(cwd: string): DiagnosticCheck {
    try {
      this.execFn('git --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err: any) {
      return {
        id: 'git_status',
        name: 'Git Version Control',
        category: 'git',
        status: 'FAIL',
        message: 'git CLI is not installed or not available in PATH',
        details: { error: err.message },
        fix: 'Install Git: https://git-scm.com',
      };
    }

    try {
      const isInsideWorkTree = this.execFn('git rev-parse --is-inside-work-tree', {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
        .trim()
        .toLowerCase();

      if (isInsideWorkTree !== 'true') {
        return {
          id: 'git_status',
          name: 'Git Repository',
          category: 'git',
          status: 'WARN',
          message: 'Current directory is not a Git repository',
          details: { cwd },
          fix: 'Run "git init" to initialize a Git repository.',
        };
      }

      let branch = 'unknown';
      try {
        branch = this.execFn('git rev-parse --abbrev-ref HEAD', {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {}

      let statusOutput = '';
      try {
        statusOutput = this.execFn('git status --porcelain', {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {}

      const dirtyLines = statusOutput ? statusOutput.split('\n').filter(Boolean) : [];
      const isClean = dirtyLines.length === 0;

      return {
        id: 'git_status',
        name: 'Git Repository',
        category: 'git',
        status: 'OK',
        message: isClean
          ? `Git repository on branch "${branch}" (working tree clean)`
          : `Git repository on branch "${branch}" (${dirtyLines.length} uncommitted changes)`,
        details: { branch, clean: isClean, changedFiles: dirtyLines.length },
      };
    } catch (err: any) {
      return {
        id: 'git_status',
        name: 'Git Repository',
        category: 'git',
        status: 'WARN',
        message: `Not inside a Git repository (${err.message})`,
        details: { error: err.message },
        fix: 'Run "git init" to initialize a Git repository.',
      };
    }
  }

  /**
   * Check GitHub CLI authentication status
   */
  checkGitHubAuth(cwd: string): DiagnosticCheck {
    try {
      this.execFn('gh --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      return {
        id: 'gh_auth',
        name: 'GitHub CLI (gh)',
        category: 'git',
        status: 'WARN',
        message: 'GitHub CLI (gh) is not installed or not in PATH',
        fix: 'Install GitHub CLI: https://cli.github.com',
      };
    }

    try {
      const output = this.execFn('gh auth status', {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const accountMatch = output.match(/account\s+([a-zA-Z0-9_-]+)/i);
      const account = accountMatch ? accountMatch[1] : undefined;

      return {
        id: 'gh_auth',
        name: 'GitHub CLI Authentication',
        category: 'git',
        status: 'OK',
        message: account
          ? `GitHub CLI authenticated as ${account}`
          : 'GitHub CLI is authenticated',
        details: { account },
      };
    } catch (err: any) {
      return {
        id: 'gh_auth',
        name: 'GitHub CLI Authentication',
        category: 'git',
        status: 'WARN',
        message: 'GitHub CLI is not authenticated',
        details: { error: err.message },
        fix: 'Run "gh auth login" to authenticate with your GitHub account.',
      };
    }
  }

  /**
   * Check 9Router Gateway connectivity
   */
  async check9RouterConnectivity(url: string, timeoutMs: number): Promise<DiagnosticCheck> {
    try {
      const res = await this.fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok || res.status < 500) {
        let modelCount = 0;
        try {
          const data = (await res.json()) as any;
          if (Array.isArray(data?.data)) {
            modelCount = data.data.length;
          }
        } catch {}

        return {
          id: 'router_connectivity',
          name: '9Router Gateway',
          category: 'gateway',
          status: 'OK',
          message: `9Router Gateway connected at ${url}${
            modelCount > 0 ? ` (${modelCount} models available)` : ''
          }`,
          details: { url, status: res.status, modelCount },
        };
      } else {
        return {
          id: 'router_connectivity',
          name: '9Router Gateway',
          category: 'gateway',
          status: 'WARN',
          message: `9Router Gateway returned HTTP ${res.status}`,
          details: { url, status: res.status },
          fix: 'Verify 9Router Gateway configuration and upstream model providers.',
        };
      }
    } catch (err: any) {
      return {
        id: 'router_connectivity',
        name: '9Router Gateway',
        category: 'gateway',
        status: 'WARN',
        message: `9Router Gateway unreachable at ${url}: ${err.message}`,
        details: { url, error: err.message },
        fix: 'Start 9Router Gateway service on port 20128 (e.g., 9router start).',
      };
    }
  }

  /**
   * Check Antigravity Proxy connectivity
   */
  async checkAntigravityProxy(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<DiagnosticCheck> {
    const isReachable = await this.socketProbeFn(host, port, timeoutMs);
    if (isReachable) {
      return {
        id: 'antigravity_proxy',
        name: 'Antigravity Proxy',
        category: 'gateway',
        status: 'OK',
        message: `Antigravity Proxy reachable at ${host}:${port}`,
        details: { host, port },
      };
    } else {
      return {
        id: 'antigravity_proxy',
        name: 'Antigravity Proxy',
        category: 'gateway',
        status: 'WARN',
        message: `Antigravity Proxy unreachable at ${host}:${port}`,
        details: { host, port },
        fix: `Start the Antigravity proxy daemon on port ${port}.`,
      };
    }
  }

  /**
   * Check Google Antigravity CLI binary
   */
  checkAgyCli(): DiagnosticCheck {
    const homeDir = os.homedir();
    const candidatePaths = [
      path.join(homeDir, '.local', 'bin', 'agy'),
      '/usr/local/bin/agy',
      '/usr/bin/agy',
    ];

    let foundPath: string | null = null;
    for (const c of candidatePaths) {
      if (fs.existsSync(c)) {
        foundPath = c;
        break;
      }
    }

    if (!foundPath) {
      try {
        const which = this.execFn('which agy', { stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (which && fs.existsSync(which)) {
          foundPath = which;
        }
      } catch {}
    }

    if (foundPath) {
      let version = '';
      try {
        version = this.execFn(`${foundPath} --version`, {
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {}

      return {
        id: 'agy_cli',
        name: 'Google Antigravity Agent (agy)',
        category: 'agents',
        status: 'OK',
        message: `agy CLI ready at ${foundPath}${version ? ` (v${version})` : ''}`,
        details: { path: foundPath, version },
      };
    }

    return {
      id: 'agy_cli',
      name: 'Google Antigravity Agent (agy)',
      category: 'agents',
      status: 'WARN',
      message: 'agy CLI binary not found in PATH or ~/.local/bin/agy',
      fix: 'Install Google Antigravity CLI (agy) into ~/.local/bin/agy or add to PATH.',
    };
  }

  /**
   * Check OpenCode CLI binary
   */
  checkOpencodeCli(): DiagnosticCheck {
    const homeDir = os.homedir();
    const candidatePaths = [
      path.join(homeDir, '.opencode', 'bin', 'opencode'),
      path.join(homeDir, '.local', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/usr/bin/opencode',
    ];

    let foundPath: string | null = null;
    for (const c of candidatePaths) {
      if (fs.existsSync(c)) {
        foundPath = c;
        break;
      }
    }

    if (!foundPath) {
      try {
        const which = this.execFn('which opencode', { stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (which && fs.existsSync(which)) {
          foundPath = which;
        }
      } catch {}
    }

    if (foundPath) {
      let version = '';
      try {
        version = this.execFn(`${foundPath} --version`, {
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {}

      return {
        id: 'opencode_cli',
        name: 'OpenCode Agent (opencode)',
        category: 'agents',
        status: 'OK',
        message: `opencode CLI ready at ${foundPath}${version ? ` (${version})` : ''}`,
        details: { path: foundPath, version },
      };
    }

    return {
      id: 'opencode_cli',
      name: 'OpenCode Agent (opencode)',
      category: 'agents',
      status: 'WARN',
      message: 'opencode CLI binary not found in PATH or ~/.opencode/bin/opencode',
      fix: 'Install OpenCode CLI: npm i -g opencode-ai@latest',
    };
  }

  /**
   * Check Claude Code CLI binary and configuration
   */
  checkClaudeCli(): DiagnosticCheck {
    const homeDir = os.homedir();
    const candidatePaths = [
      path.join(homeDir, '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/usr/bin/claude',
    ];

    let foundPath: string | null = null;
    for (const c of candidatePaths) {
      if (fs.existsSync(c)) {
        foundPath = c;
        break;
      }
    }

    if (!foundPath) {
      try {
        const which = this.execFn('which claude', { stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (which && fs.existsSync(which)) {
          foundPath = which;
        }
      } catch {}
    }

    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    const hasSettings = fs.existsSync(settingsPath);

    if (foundPath) {
      let version = '';
      try {
        version = this.execFn(`${foundPath} --version`, {
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {}

      const configNote = hasSettings ? ' (config: ~/.claude/settings.json)' : '';
      return {
        id: 'claude_cli',
        name: 'Claude Code Agent (claude)',
        category: 'agents',
        status: 'OK',
        message: `claude CLI ready at ${foundPath}${version ? ` (${version})` : ''}${configNote}`,
        details: { path: foundPath, version, settingsConfigured: hasSettings },
      };
    }

    return {
      id: 'claude_cli',
      name: 'Claude Code Agent (claude)',
      category: 'agents',
      status: 'WARN',
      message: 'claude CLI binary not found in PATH or ~/.local/bin/claude',
      fix: 'Install Claude Code CLI globally: npm install -g @anthropic-ai/claude-code',
    };
  }

  /**
   * Check factory.yaml validity
   */
  checkFactoryConfig(cwd: string, explicitPath?: string): DiagnosticCheck {
    const loader = this.configLoader || new ConfigLoaderService(cwd);
    const result = loader.validateConfigFile(explicitPath);

    if (!result.valid) {
      return {
        id: 'factory_config',
        name: 'Factory Configuration (factory.yaml)',
        category: 'config',
        status: 'FAIL',
        message: `factory.yaml validation errors: ${result.errors?.join('; ')}`,
        details: { errors: result.errors, path: result.path },
        fix: 'Review and fix the configuration syntax or schema errors in factory.yaml.',
      };
    }

    if (result.path) {
      const actorCount = result.config?.actors.length || 0;
      const stageCount = result.config?.stages.length || 0;
      const configName = result.config?.name || 'unknown';
      return {
        id: 'factory_config',
        name: 'Factory Configuration (factory.yaml)',
        category: 'config',
        status: 'OK',
        message: `factory.yaml is valid at ${result.path} (name: "${configName}", ${actorCount} actors, ${stageCount} stages)`,
        details: {
          path: result.path,
          name: result.config?.name,
          version: result.config?.version,
          actors: actorCount,
          stages: stageCount,
        },
      };
    }

    return {
      id: 'factory_config',
      name: 'Factory Configuration (factory.yaml)',
      category: 'config',
      status: 'WARN',
      message: 'No factory.yaml found (using built-in fallback configuration)',
      fix: 'Run "factory init" to generate a factory.yaml file.',
    };
  }

  /**
   * Check SQLite database read/write access
   */
  checkDatabase(cwd: string, customDbPath?: string): DiagnosticCheck {
    let resolvedPath = '';
    let dbInstance: DatabaseSync | null = null;
    let shouldClose = false;

    try {
      if (customDbPath) {
        resolvedPath = path.isAbsolute(customDbPath)
          ? customDbPath
          : path.resolve(cwd, customDbPath);
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        dbInstance = new DatabaseSync(resolvedPath);
        shouldClose = true;
      } else if (this.dbService) {
        resolvedPath = this.dbService.getDbPath();
        dbInstance = this.dbService.getDb();
      } else {
        const defaultDir = path.join(cwd, 'data');
        if (!fs.existsSync(defaultDir)) {
          fs.mkdirSync(defaultDir, { recursive: true });
        }
        resolvedPath = path.join(defaultDir, 'factory.db');
        dbInstance = new DatabaseSync(resolvedPath);
        shouldClose = true;
      }

      // Verify read
      dbInstance.exec('SELECT 1;');

      // Verify write (temporary diagnostic probe table)
      dbInstance.exec(
        'CREATE TEMP TABLE IF NOT EXISTS _doctor_probe (id INT); INSERT INTO _doctor_probe VALUES (1); DROP TABLE _doctor_probe;',
      );

      return {
        id: 'database_storage',
        name: 'SQLite Database Store',
        category: 'storage',
        status: 'OK',
        message: `SQLite database read/write operational at ${resolvedPath}`,
        details: { dbPath: resolvedPath },
      };
    } catch (err: any) {
      return {
        id: 'database_storage',
        name: 'SQLite Database Store',
        category: 'storage',
        status: 'FAIL',
        message: `SQLite database read/write failed: ${err.message}`,
        details: { dbPath: resolvedPath, error: err.message },
        fix: 'Check directory permissions and ensure SQLite database path is writable.',
      };
    } finally {
      if (shouldClose && dbInstance) {
        try {
          dbInstance.close();
        } catch {}
      }
    }
  }

  /**
   * Format diagnostic report for terminal display
   */
  formatReport(report: DoctorReport): string {
    const lines: string[] = [];
    lines.push('====================================================');
    lines.push('🩺 Software Factory System & Environment Doctor');
    lines.push('====================================================');
    lines.push(`Timestamp: ${report.timestamp}`);

    let overallBadge = '✅ ALL CHECKS PASSED';
    if (report.overallStatus === 'FAIL') {
      overallBadge = '❌ FAILURES DETECTED';
    } else if (report.overallStatus === 'WARN') {
      overallBadge = '⚠️  WARNINGS DETECTED';
    }
    lines.push(`Overall Status: ${overallBadge}\n`);

    const categoryTitles: Record<string, string> = {
      runtime: 'Runtime & Environment',
      git: 'Git & GitHub CLI',
      gateway: 'Gateways & Proxies',
      agents: 'Agent Executables & CLI',
      config: 'Factory Configuration',
      storage: 'Database & Storage',
    };

    const categories = ['runtime', 'git', 'gateway', 'agents', 'config', 'storage'] as const;

    for (const cat of categories) {
      const checks = report.checks.filter((c) => c.category === cat);
      if (!checks.length) continue;

      lines.push(`[${categoryTitles[cat] || cat}]`);
      for (const check of checks) {
        const badge =
          check.status === 'OK'
            ? '  [OK]  '
            : check.status === 'WARN'
              ? '  [WARN]'
              : '  [FAIL]';
        lines.push(`${badge} ${check.name}: ${check.message}`);
      }
      lines.push('');
    }

    const fixes = report.checks.filter((c) => c.status !== 'OK' && c.fix);
    if (fixes.length > 0) {
      lines.push('----------------------------------------------------');
      lines.push('🔧 Actionable Fixes & Recommendations:');
      for (const f of fixes) {
        lines.push(`  - [${f.name}] ${f.fix}`);
      }
      lines.push('');
    }

    lines.push('----------------------------------------------------');
    lines.push(
      `Summary: ${report.summary.total} total (${report.summary.ok} OK, ${report.summary.warn} WARN, ${report.summary.fail} FAIL)`,
    );
    lines.push('====================================================');

    return lines.join('\n');
  }
}
