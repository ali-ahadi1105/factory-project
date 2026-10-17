#!/usr/bin/env node
import 'reflect-metadata';
import 'dotenv/config';
import { Command } from 'commander';
import * as yaml from 'yaml';
import { ConfigLoaderService } from './config';
import { DatabaseService, FactoryStoreService } from './store';
import {
  DoctorService,
  InitService,
  LineageService,
  OrchestratorService,
  ProgressDispatcherService,
  ReporterService,
  StageRunnerService,
} from './engine';
import {
  AgyAdapter,
  ClaudeAdapter,
  OpencodeAdapter,
  GitHubAdapter,
  TelegramAdapter,
} from './adapters';
import { WorkStatus, WorkType, WorkPriority, CanonicalUri } from './core';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';

const program = new Command();

function initServices(projectPath?: string) {
  const baseDir = projectPath
    ? fs.existsSync(projectPath) && fs.statSync(projectPath).isFile()
      ? path.dirname(projectPath)
      : path.resolve(projectPath)
    : process.cwd();

  const configLoader = new ConfigLoaderService(baseDir);
  const dbService = new DatabaseService();
  dbService.connect();
  const store = new FactoryStoreService(dbService);
  const lineage = new LineageService(store);
  const reporter = new ReporterService(store, lineage);
  const progressDispatcher = new ProgressDispatcherService(reporter);
  const stageRunner = new StageRunnerService(store, lineage, reporter);
  const agyAdapter = new AgyAdapter();
  const claudeAdapter = new ClaudeAdapter();
  const opencodeAdapter = new OpencodeAdapter();
  stageRunner.registerAdapter(agyAdapter);
  stageRunner.registerAdapter(claudeAdapter);
  stageRunner.registerAdapter(opencodeAdapter);
  const githubAdapter = new GitHubAdapter();
  const telegramAdapter = new TelegramAdapter();
  const orchestrator = new OrchestratorService(
    store,
    lineage,
    agyAdapter,
    claudeAdapter,
    githubAdapter,
    telegramAdapter,
    reporter,
    configLoader,
    stageRunner,
    opencodeAdapter,
    progressDispatcher,
  );
  const doctor = new DoctorService(configLoader, dbService);
  const initService = new InitService(store, dbService);

  return {
    configLoader,
    dbService,
    store,
    lineage,
    reporter,
    progressDispatcher,
    stageRunner,
    orchestrator,
    githubAdapter,
    telegramAdapter,
    doctor,
    initService,
  };
}

program
  .name('factory')
  .description('Software Factory - System of Coordination (Concept v31)')
  .version('0.1.0')
  .option('--project <path>', 'Custom path to project directory or factory.yaml');

// doctor command
program
  .command('doctor')
  .description('Run comprehensive environment, agent, gateway, and configuration diagnostics')
  .option('--json', 'Output diagnostics as JSON')
  .action(async (options) => {
    const project = program.opts().project;
    const { doctor } = initServices(project);
    try {
      const targetCwd = project ? path.resolve(process.cwd(), project) : process.cwd();
      const report = await doctor.runDiagnostics({ cwd: targetCwd });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(doctor.formatReport(report));
      }
      if (report.overallStatus === 'FAIL') {
        process.exitCode = 1;
      }
    } catch (err: any) {
      console.error(`❌ Doctor diagnostics failed: ${err.message}`);
      process.exitCode = 1;
    }
  });

// init command
program
  .command('init [dir]')
  .description('Bootstrap repository for Factory orchestration (factory.yaml, AGENTS.md, CLAUDE.md)')
  .option('-f, --force', 'Overwrite existing configuration files', false)
  .action(async (dir, options) => {
    const targetDir = dir ? path.resolve(process.cwd(), dir) : process.cwd();
    const { initService, store } = initServices(targetDir);
    try {
      const result = await initService.initProject(targetDir, { force: options.force });
      console.log(`\n🚀 Software Factory Initialized in: ${result.targetDir}`);
      console.log(`   Project Name:   ${result.projectName}`);
      if (result.repository) {
        console.log(`   GitHub Repo:    ${result.repository}`);
      }
      console.log(`   Default Branch: ${result.defaultBranch}`);

      if (result.createdFiles.length > 0) {
        console.log(`\n📄 Created files:`);
        for (const f of result.createdFiles) {
          console.log(`   ✅ ${f}`);
        }
      }
      if (result.overwrittenFiles.length > 0) {
        console.log(`\n🔄 Overwritten files (--force):`);
        for (const f of result.overwrittenFiles) {
          console.log(`   ⚠️  ${f}`);
        }
      }
      if (result.skippedFiles.length > 0) {
        console.log(`\n⏭️  Skipped existing files (use --force to overwrite):`);
        for (const f of result.skippedFiles) {
          console.log(`   ℹ️  ${f}`);
        }
      }
      if (result.dbPath) {
        console.log(`\n💾 Database initialized at: ${result.dbPath}`);
      }
      const actors = store.listActors();
      console.log(`📋 Registered actors: ${actors.map((a) => a.id).join(', ')}`);
    } catch (err: any) {
      console.error(`❌ Initialization failed: ${err.message}`);
      process.exitCode = 1;
    }
  });

// work commands
const workCmd = program.command('work').description('Manage Factory Work items');

workCmd
  .command('list')
  .description('List all work items')
  .option('-s, --status <status>', 'Filter by status')
  .action((options) => {
    const { store } = initServices();
    const works = store.listWorks(options.status as any);
    if (!works.length) {
      console.log('No work items found.');
      return;
    }
    console.table(
      works.map((w) => ({
        ID: w.id,
        Title: w.title.slice(0, 30),
        Status: w.status,
        Priority: w.priority,
        Actor: w.assignedActorId || '-',
        Created: w.createdAt.slice(0, 19),
      })),
    );
  });

workCmd
  .command('create <title>')
  .description('Create a new Work item')
  .option('-d, --desc <description>', 'Work description', '')
  .option('-t, --type <type>', 'Work type', WorkType.IMPLEMENTATION)
  .option('-p, --priority <priority>', 'Priority', WorkPriority.MEDIUM)
  .action((title, options) => {
    const { store } = initServices();
    const now = new Date().toISOString();
    const work = store.saveWork({
      id: crypto.randomUUID(),
      title,
      description: options.desc,
      type: options.type as any,
      status: WorkStatus.PENDING,
      priority: options.priority as any,
      context: {},
      createdAt: now,
      updatedAt: now,
    });
    console.log(`✅ Work created: ${work.id}`);
  });

workCmd
  .command('triage <workId>')
  .description('Inspect failure root causes and relations for a Work item')
  .action((workId) => {
    const { orchestrator } = initServices();
    try {
      const report = orchestrator.triage(workId);
      console.log(orchestrator.formatTriageReport(report));
    } catch (err: any) {
      console.error(`❌ Triage failed: ${err.message}`);
    }
  });

// run command
program
  .command('run <workId>')
  .description('Execute a work item with an actor')
  .option('-a, --actor <actorId>', 'Actor ID (e.g. agy, claude)', 'agy')
  .option('-d, --dir <directory>', 'Working directory', process.cwd())
  .action(async (workId, options) => {
    const { orchestrator } = initServices();
    console.log(`🚀 Executing work ${workId} with actor ${options.actor}...`);
    try {
      const res = await orchestrator.executeWork(workId, options.actor, options.dir);
      console.log(`Status: ${res.status}`);
      if (res.error) console.error(`Error: ${res.error}`);
      console.log('\n--- Logs ---');
      console.log(res.logs.slice(-1000));
    } catch (err: any) {
      console.error(`❌ Execution failed: ${err.message}`);
    }
  });

// pipeline command
program
  .command('pipeline <title>')
  .description('Run full end-to-end pipeline: agy/claude (implement) -> claude (review) -> PR')
  .option('-d, --desc <description>', 'Description', '')
  .option('-a, --actor <actorId>', 'Implementer actor ID (claude or agy)', 'claude')
  .option('--issue <issueNumber>', 'Existing GitHub issue number')
  .option('--repo <githubRepo>', 'GitHub repo (e.g. ali-ahadi1105/factory-project)')
  .option('--dir <directory>', 'Working directory', process.cwd())
  .option('--telegram', 'Enable live Telegram progress notifications')
  .option('--chat-id <chatId>', 'Telegram Chat ID (defaults to TELEGRAM_CHAT_ID env)')
  .option('--bot-token <botToken>', 'Telegram Bot Token (defaults to TELEGRAM_BOT_TOKEN env)')
  .action(async (title, options) => {
    const { orchestrator } = initServices();
    console.log(`🚀 Triggering pipeline for: "${title}"...`);

    const botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
    const telegramNotification =
      (options.telegram || botToken) && chatId
        ? {
            botToken,
            chatId,
          }
        : undefined;

    if (telegramNotification) {
      console.log(`📲 Live Telegram notifications enabled for Chat ID: ${chatId}`);
    }

    try {
      const result = await orchestrator.runPipeline({
        title,
        description: options.desc,
        workingDirectory: options.dir,
        githubRepo: options.repo,
        implementer: options.actor as any,
        issueNumber: options.issue ? parseInt(options.issue, 10) : undefined,
        telegramNotification,
      });

      console.log('\n✅ Pipeline Finished!');
      console.log(`Work ID: ${result.workId}`);
      if (result.issueUrl) console.log(`📌 GitHub Issue: ${result.issueUrl} (#${result.issueNumber})`);
      if (result.branchName) console.log(`🌿 Git Branch: ${result.branchName}`);
      if (result.prUrl) console.log(`🔗 Pull Request: ${result.prUrl} (#${result.prNumber})`);
      console.log(`🧪 Automated Tests: ${result.testPassed ? '✅ PASSED' : '⚠️ FAILED'}`);
      if (result.error) {
        console.log(`\n❌ Pipeline halted without PR: ${result.error}`);
        console.log(`🔍 Inspect root cause: factory triage ${result.workId}`);
      }
      console.log('\n📊 Lineage Tree:');
      console.log(result.lineageTree);
    } catch (err: any) {
      console.error(`❌ Pipeline failed: ${err.message}`);
    }
  });

// triage command
program
  .command('triage <workId>')
  .description('Inspect failure root causes and relations for a work item')
  .action((workId) => {
    const { orchestrator } = initServices();
    try {
      const report = orchestrator.triage(workId);
      console.log(orchestrator.formatTriageReport(report));
    } catch (err: any) {
      console.error(`❌ Triage failed: ${err.message}`);
    }
  });

// lineage command
program
  .command('lineage <rootRef>')
  .description('Display ASCII lineage tree for an entity URI or Work ID')
  .action((rootRef) => {
    const { lineage } = initServices();
    const uri = rootRef.includes('://') ? rootRef : CanonicalUri.factoryWork(rootRef);
    console.log(lineage.formatAsciiTree(uri));
  });

// report command
program
  .command('report')
  .description('Generate HTML or Markdown report for the factory or specific work item')
  .option('-f, --format <format>', 'Report format: html or markdown', 'html')
  .option('-w, --work <workId>', 'Target specific Work ID')
  .option('-o, --out <path>', 'Output file path')
  .option('-m, --manager', 'Generate executive manager-ready report (Persian, dual calendar)')
  .action((options) => {
    const { reporter } = initServices();
    const format = options.format.toLowerCase() === 'markdown' ? 'markdown' : 'html';
    const isManager = Boolean(options.manager);
    const prefix = isManager ? 'executive-manager-report' : 'factory-report';
    const defaultFilename = options.work
      ? `factory-work-${options.work}.${format === 'markdown' ? 'md' : 'html'}`
      : `${prefix}.${format === 'markdown' ? 'md' : 'html'}`;
    const outPath = options.out || path.join(process.cwd(), 'reports', defaultFilename);

    const generated = reporter.exportReport(outPath, format, {
      workId: options.work,
      manager: isManager,
    });
    console.log(`✅ ${isManager ? 'Manager ' : ''}${format.toUpperCase()} report generated: ${generated}`);
  });

// dashboard command
program
  .command('dashboard')
  .description('Start live web dashboard server')
  .option('-p, --port <port>', 'Port number to listen on', '3000')
  .option('-h, --host <host>', 'Host address to bind', '0.0.0.0')
  .action(async (options) => {
    const { reporter } = initServices();
    const port = parseInt(options.port, 10);
    const host = options.host;
    console.log(`🚀 Starting Software Factory Dashboard on http://${host}:${port}...`);
    try {
      await reporter.serveDashboard(port, host);
      console.log(`✅ Dashboard running! Open http://localhost:${port} in your browser.`);
      console.log('Press Ctrl+C to stop.');
    } catch (err: any) {
      console.error(`❌ Failed to start dashboard server: ${err.message}`);
    }
  });

// actor command
const actorCmd = program.command('actor').description('Manage Actors');
actorCmd
  .command('list')
  .description('List registered actors')
  .action(() => {
    const { store } = initServices();
    const actors = store.listActors();
    console.table(
      actors.map((a) => ({
        ID: a.id,
        Name: a.name,
        Type: a.type,
        Adapter: a.adapterType,
        Availability: a.availability,
        Autonomy: a.autonomyLevel,
      })),
    );
  });

// daemon command
program
  .command('daemon')
  .description('Run continuous coordination daemon')
  .option('-i, --interval <seconds>', 'Polling interval', '10')
  .action(async (options) => {
    const { store, orchestrator } = initServices();
    const intervalSec = parseInt(options.interval, 10);
    console.log(`🤖 Software Factory Daemon running (polling every ${intervalSec}s)...`);
    console.log('Press Ctrl+C to stop.');

    const checkPending = async () => {
      const pendingWorks = store.listWorks(WorkStatus.PENDING);
      if (pendingWorks.length > 0) {
        console.log(`[Daemon] Found ${pendingWorks.length} pending work items.`);
        for (const work of pendingWorks) {
          const actorId = work.assignedActorId || (work.type === WorkType.REVIEW ? 'claude' : 'agy');
          console.log(`[Daemon] Processing work "${work.title}" (${work.id}) via ${actorId}...`);
          try {
            await orchestrator.executeWork(work.id, actorId, process.cwd());
            console.log(`[Daemon] Completed work ${work.id}`);
          } catch (err: any) {
            console.error(`[Daemon] Error processing work ${work.id}: ${err.message}`);
          }
        }
      }
    };

    setInterval(checkPending, intervalSec * 1000);
    await checkPending();
  });

// config command
const configCmd = program.command('config').description('Manage Factory configuration');

configCmd
  .command('validate')
  .description('Validate factory.yaml configuration file')
  .option('-p, --path <path>', 'Path to factory.yaml')
  .action((options) => {
    const { configLoader } = initServices();
    const result = configLoader.validateConfigFile(options.path);
    if (result.valid) {
      const source = result.path || 'built-in fallback defaults (no factory.yaml found)';
      console.log(`✅ Configuration is valid! Loaded from: ${source}`);
      console.log(`   Factory: ${result.config?.name} v${result.config?.version}`);
      console.log(`   Actors:  ${result.config?.actors.length || 0} configured`);
      console.log(`   Stages:  ${result.config?.stages.length || 0} configured`);
    } else {
      console.error(`❌ Configuration validation failed!`);
      if (result.errors && result.errors.length > 0) {
        for (const err of result.errors) {
          console.error(`   - ${err}`);
        }
      }
      process.exitCode = 1;
    }
  });

configCmd
  .command('show')
  .description('Display the active Factory configuration')
  .option('-p, --path <path>', 'Path to factory.yaml')
  .option('-f, --format <format>', 'Output format: yaml or json', 'yaml')
  .action((options) => {
    const { configLoader } = initServices();
    try {
      const config = options.path ? configLoader.loadConfig(options.path) : configLoader.getConfig();
      const loadedPath = configLoader.getLoadedPath();
      console.log(`# Source: ${loadedPath || 'Built-in Fallback Defaults'}`);
      if (options.format.toLowerCase() === 'json') {
        console.log(JSON.stringify(config, null, 2));
      } else {
        console.log(yaml.stringify(config));
      }
    } catch (err: any) {
      console.error(`❌ Failed to show config: ${err.message}`);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);
