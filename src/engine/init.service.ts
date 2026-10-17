import { Injectable, Logger, Optional } from '@nestjs/common';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { DatabaseService, FactoryStoreService } from '../store';
import { FactoryConfigSchema } from '../config/schema';
import {
  ActorType,
  AdapterType,
  ActorAvailability,
  AutonomyLevel,
} from '../core';

export interface ProjectInfo {
  projectName: string;
  repository?: string;
  defaultBranch: string;
  owner?: string;
}

export interface InitOptions {
  force?: boolean;
  projectName?: string;
  repository?: string;
  defaultBranch?: string;
  owner?: string;
  initDatabase?: boolean;
}

export interface InitResult {
  targetDir: string;
  projectName: string;
  repository?: string;
  defaultBranch: string;
  owner?: string;
  createdFiles: string[];
  skippedFiles: string[];
  overwrittenFiles: string[];
  dbPath?: string;
}

export interface InitServiceInjections {
  execFn?: (cmd: string, options?: any) => string;
}

@Injectable()
export class InitService {
  private readonly logger = new Logger(InitService.name);
  private execFn: (cmd: string, options?: any) => string;

  constructor(
    @Optional() private readonly store?: FactoryStoreService,
    @Optional() private readonly dbService?: DatabaseService,
    @Optional() customInjections?: InitServiceInjections,
  ) {
    this.execFn =
      customInjections?.execFn ||
      ((cmd: string, options?: any) => child_process.execSync(cmd, options).toString());
  }

  /**
   * Detect repository and project metadata from target directory or git
   */
  detectProjectInfo(targetDir: string): ProjectInfo {
    let repository: string | undefined;
    let owner: string | undefined;
    let defaultBranch = 'main';
    let projectName = path.basename(path.resolve(targetDir));

    try {
      const remoteUrl = this.execFn('git config --get remote.origin.url', {
        cwd: targetDir,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      if (remoteUrl) {
        // Parse GitHub SSH (git@github.com:owner/repo.git) or HTTPS (https://github.com/owner/repo.git)
        const match = remoteUrl.match(/[:/]([^/:]+)\/([^/:]+?)(?:\.git)?$/);
        if (match) {
          owner = match[1];
          const repoName = match[2];
          repository = `${owner}/${repoName}`;
          if (!projectName || projectName === '.' || projectName === 'src') {
            projectName = repoName;
          }
        }
      }
    } catch {
      // Git command failed or not a git repository
    }

    try {
      const branch = this.execFn('git branch --show-current', {
        cwd: targetDir,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (branch) {
        defaultBranch = branch;
      }
    } catch {
      // Default to main
    }

    if (!owner) {
      try {
        const gitUser = this.execFn('git config user.name', {
          cwd: targetDir,
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        if (gitUser) {
          owner = gitUser;
        }
      } catch {}
    }

    if (!owner) {
      owner = process.env.USER || 'developer';
    }

    if (!projectName || projectName === '.' || projectName === '') {
      projectName = 'software-factory';
    }

    return {
      projectName,
      repository,
      defaultBranch,
      owner,
    };
  }

  /**
   * Generate valid factory.yaml configuration content
   */
  generateFactoryYaml(info: ProjectInfo): string {
    const ownerName = info.owner || 'developer';
    const ownerSlug = ownerName.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'owner';

    const configObj: Record<string, any> = {
      name: info.projectName,
      version: '1.0.0',
      description: `Software Factory configuration for ${info.projectName}`,
      defaultBranch: info.defaultBranch,
    };

    if (info.repository) {
      configObj.repository = info.repository;
    }

    configObj.metadata = {
      architecture: 'Concept v31',
      owner: ownerName,
    };

    configObj.actors = [
      {
        id: 'opencode',
        name: 'OpenCode CLI Agent',
        type: 'internal_agent',
        adapter: 'cli',
        model: 'opencode/deepseek-v4.1-flash-free',
        capabilities: ['code_generation', 'implementation', 'refactoring', 'tests', 'debugging'],
        availability: 'available',
        autonomy: 'semi_autonomous',
      },
      {
        id: 'agy',
        name: 'Google Antigravity Agent',
        type: 'internal_agent',
        adapter: 'cli',
        model: 'gemini-3.8-flash',
        capabilities: ['code_generation', 'implementation', 'refactoring'],
        availability: 'available',
        autonomy: 'semi_autonomous',
      },
      {
        id: 'claude',
        name: 'Claude Code Agent',
        type: 'internal_agent',
        adapter: 'cli',
        model: 'claude-3-7-sonnet',
        capabilities: ['architecture', 'code_review', 'security_audit', 'planning'],
        availability: 'available',
        autonomy: 'semi_autonomous',
      },
      {
        id: `human:${ownerSlug}`,
        name: `${ownerName} (Human Gate)`,
        type: 'human',
        adapter: 'manual',
        capabilities: ['approval', 'architecture_decision', 'merge'],
        availability: 'available',
        autonomy: 'human_only',
        owner: ownerName,
      },
    ];

    configObj.policies = {
      defaultAutonomy: 'semi_autonomous',
      requireApproval: true,
      timeoutSeconds: 300,
      maxRetries: 1,
      autoFallback: true,
      testCommand: 'pnpm test || npm test',
      skipTests: false,
    };

    configObj.stages = [
      {
        name: 'issue',
        description: 'Create GitHub Issue first (System of Record)',
        required: true,
      },
      {
        name: 'branch',
        description: 'Create isolated Git Branch',
        required: true,
      },
      {
        name: 'implement',
        actor: 'opencode',
        description: 'Implementation via opencode with automatic fallback to claude',
        required: true,
        timeoutSeconds: 300,
      },
      {
        name: 'review',
        actor: 'claude',
        description: 'Review and verification via claude',
        required: true,
        timeoutSeconds: 300,
      },
      {
        name: 'test',
        description: 'Run automated test suite',
        required: true,
      },
      {
        name: 'pr',
        description: 'Commit, push, and open Pull Request',
        required: true,
      },
    ];

    // Ensure generated config validates cleanly against schema
    FactoryConfigSchema.parse(configObj);

    return yaml.stringify(configObj);
  }

  /**
   * Generate AGENTS.md protocol documentation
   */
  generateAgentsMd(info: ProjectInfo): string {
    const repoTarget = info.repository ? info.repository : '<owner>/<repo>';
    return `# Software Factory (${info.projectName})

System of Coordination for software development, orchestrating humans, agents (agy, claude), and tools (GitHub, Telegram).

## Core Architecture (Based on Concept v31)
- **Role:** System of Coordination, NOT System of Record. External data stays in external systems; Factory stores only \`Reference + Relation + Coordination State\`.
- **Minimal Core Primitives:**
  - \`Work\`: Task to track/perform (\`status\`, \`title\`, \`description\`, \`context\`, \`id\`)
  - \`Actor\`: Performer of work (Human or Agent share the SAME model with \`actor_type\`, \`id\`, \`capabilities\`, \`adapter\`)
  - \`Execution\`: Run/attempt of Work (\`id\`, \`work_id\`, \`actor_id\`, \`status\`, \`correlation_id\`, \`causation_id\`, \`logs\`)
  - \`Reference\`: Persistent pointer to entity (\`uri\` like \`github://issue/1\`, \`git://commit/sha\`, \`file://path\`)
  - \`Relation\`: Link between entities (\`relation_type\`: \`triggered-by\`, \`performed-by\`, \`produced\`, \`depends-on\`, \`verifies\`, \`derived-from\`, \`caused\`)
  - \`Event\` / \`Signal\`: Incoming triggers moving the flow.

## Technology Stack & Environment
- **Runtime:** Node.js v24+/v26+ with TypeScript
- **Architecture:** Clean Modular Architecture (NestJS / TypeScript)
- **Package Manager:** \`pnpm\`
- **Database:** SQLite (\`factory.db\`) using better-sqlite3 or sqlite3 for local persistence of Core primitives and relations
- **CLI & Daemon:** Standalone entrypoint / commands for daemon, work, lineage, signal intake
- **Testing:** \`jest\` / \`vitest\` via \`pnpm test\`
- **Agent Executables:**
  - \`agy\`: \`$HOME/.local/bin/agy\` (Google Antigravity CLI)
  - \`claude\`: \`$HOME/.local/bin/claude\` (Claude Code CLI)

## Standards
- Strict TypeScript (\`strict: true\`)
- Full documentation & typed DTOs/Entities
- 100% test coverage for core domain services and adapters
- Non-blocking error handling and graceful degradation

## Mandatory Factory Pipeline Protocol (For All Agents & Orchestrators)
Whenever a development task or bug fix is requested (via Telegram, CLI, or Chat):
1. **Never perform local-only modifications without completing the full lifecycle.**
2. **Phase 1 - Issue First:** An Issue MUST be created on GitHub (\`${repoTarget}\`) to establish the task in the System of Record.
3. **Phase 2 - Feature Branch:** Work MUST be isolated in \`feature/issue-{num}-{slug}\`.
4. **Phase 3 - Implementation & Fallback:** Try \`agy\` (Gemini 3.8 Flash). If \`agy\` encounters tool permission limits or timeout, automatically fallback to \`claude\`. Verify all project tests pass (\`pnpm test\`).
5. **Phase 4 - Code Review:** \`claude\` reviews the diff for security and code quality.
6. **Phase 5 - Push & Pull Request:** Commit, push branch to origin, and open a Pull Request linking \`Closes #{issue}\` for human approval.
7. **Deliverable Delivery:** Always provide the GitHub Issue link, Pull Request link, test verification status, and Lineage graph.
`;
  }

  /**
   * Generate CLAUDE.md guidelines
   */
  generateClaudeMd(info: ProjectInfo): string {
    return this.generateAgentsMd(info);
  }

  /**
   * Bootstrap any target directory with Factory configuration and protocols
   */
  async initProject(targetDir: string = process.cwd(), options: InitOptions = {}): Promise<InitResult> {
    const resolvedDir = path.resolve(targetDir);
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    const detected = this.detectProjectInfo(resolvedDir);
    const info: ProjectInfo = {
      projectName: options.projectName || detected.projectName,
      repository: options.repository !== undefined ? options.repository : detected.repository,
      defaultBranch: options.defaultBranch || detected.defaultBranch,
      owner: options.owner || detected.owner,
    };

    const createdFiles: string[] = [];
    const skippedFiles: string[] = [];
    const overwrittenFiles: string[] = [];

    const filesToGenerate: Array<{ name: string; content: string }> = [
      { name: 'factory.yaml', content: this.generateFactoryYaml(info) },
      { name: 'AGENTS.md', content: this.generateAgentsMd(info) },
      { name: 'CLAUDE.md', content: this.generateClaudeMd(info) },
    ];

    for (const file of filesToGenerate) {
      const filePath = path.join(resolvedDir, file.name);
      const exists = fs.existsSync(filePath);

      if (exists) {
        if (options.force) {
          fs.writeFileSync(filePath, file.content, 'utf-8');
          overwrittenFiles.push(file.name);
        } else {
          skippedFiles.push(file.name);
        }
      } else {
        fs.writeFileSync(filePath, file.content, 'utf-8');
        createdFiles.push(file.name);
      }
    }

    let dbPath: string | undefined;
    if (options.initDatabase !== false) {
      try {
        const dataDir = path.join(resolvedDir, 'data');
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
        dbPath = path.join(dataDir, 'factory.db');

        const db = new DatabaseService(dbPath);
        db.connect();

        const store = new FactoryStoreService(db);
        const ownerName = info.owner || 'developer';
        const ownerSlug = ownerName.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'owner';
        const now = new Date().toISOString();

        // Seed default actors into database
        const defaultActors = [
          {
            id: 'agy',
            name: 'Google Antigravity Agent',
            type: ActorType.INTERNAL_AGENT,
            adapterType: AdapterType.CLI,
            capabilities: ['code_generation', 'implementation', 'refactoring'],
            availability: ActorAvailability.AVAILABLE,
            autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
            config: { model: 'gemini-3.8-flash' },
            createdAt: now,
          },
          {
            id: 'claude',
            name: 'Claude Code Agent',
            type: ActorType.INTERNAL_AGENT,
            adapterType: AdapterType.CLI,
            capabilities: ['architecture', 'code_review', 'security_audit', 'planning'],
            availability: ActorAvailability.AVAILABLE,
            autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
            config: { model: 'claude-3-7-sonnet' },
            createdAt: now,
          },
          {
            id: `human:${ownerSlug}`,
            name: `${ownerName} (Human Gate)`,
            type: ActorType.HUMAN,
            adapterType: AdapterType.MANUAL,
            capabilities: ['approval', 'architecture_decision', 'merge'],
            availability: ActorAvailability.AVAILABLE,
            autonomyLevel: AutonomyLevel.HUMAN_ONLY,
            owner: ownerName,
            config: {},
            createdAt: now,
          },
        ];

        for (const actor of defaultActors) {
          if (!store.getActor(actor.id)) {
            store.saveActor(actor);
          }
        }

        db.close();
      } catch (err: any) {
        this.logger.warn(`Failed to initialize SQLite database: ${err.message}`);
      }
    }

    return {
      targetDir: resolvedDir,
      projectName: info.projectName,
      repository: info.repository,
      defaultBranch: info.defaultBranch,
      owner: info.owner,
      createdFiles,
      skippedFiles,
      overwrittenFiles,
      dbPath,
    };
  }
}
