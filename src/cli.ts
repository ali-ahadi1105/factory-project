#!/usr/bin/env node
import 'reflect-metadata';
import { Command } from 'commander';
import { DatabaseService, FactoryStoreService } from './store';
import { LineageService, OrchestratorService } from './engine';
import { AgyAdapter, ClaudeAdapter, GitHubAdapter } from './adapters';
import { WorkStatus, WorkType, WorkPriority, CanonicalUri } from './core';
import * as crypto from 'node:crypto';

const program = new Command();

function initServices() {
  const dbService = new DatabaseService();
  dbService.connect();
  const store = new FactoryStoreService(dbService);
  const lineage = new LineageService(store);
  const agyAdapter = new AgyAdapter();
  const claudeAdapter = new ClaudeAdapter();
  const githubAdapter = new GitHubAdapter();
  const orchestrator = new OrchestratorService(
    store,
    lineage,
    agyAdapter,
    claudeAdapter,
    githubAdapter,
  );
  return { dbService, store, lineage, orchestrator, githubAdapter };
}

program
  .name('factory')
  .description('Software Factory - System of Coordination (Concept v31)')
  .version('0.1.0');

// init command
program
  .command('init')
  .description('Initialize Factory database and default actors')
  .action(() => {
    const { store, dbService } = initServices();
    console.log(`✅ Factory database initialized at: ${dbService.getDbPath()}`);
    const actors = store.listActors();
    console.log(`📋 Registered actors: ${actors.map((a) => a.id).join(', ')}`);
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
  .description('Run full end-to-end pipeline: agy (implement) -> claude (review) -> PR')
  .option('-d, --desc <description>', 'Description', '')
  .option('--repo <githubRepo>', 'GitHub repo (e.g. ali-ahadi1105/factory-project)')
  .option('--dir <directory>', 'Working directory', process.cwd())
  .action(async (title, options) => {
    const { orchestrator } = initServices();
    console.log(`🚀 Triggering pipeline for: "${title}"...`);
    try {
      const result = await orchestrator.runPipeline({
        title,
        description: options.desc,
        workingDirectory: options.dir,
        githubRepo: options.repo,
      });

      console.log('\n✅ Pipeline Finished!');
      console.log(`Work ID: ${result.workId}`);
      if (result.prUrl) console.log(`🔗 Pull Request: ${result.prUrl}`);
      console.log('\n📊 Lineage Tree:');
      console.log(result.lineageTree);
    } catch (err: any) {
      console.error(`❌ Pipeline failed: ${err.message}`);
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

program.parse(process.argv);
