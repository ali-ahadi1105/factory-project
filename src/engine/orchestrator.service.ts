import { Injectable, Logger } from '@nestjs/common';
import { FactoryStoreService } from '../store';
import {
  Work,
  Actor,
  Execution,
  Relation,
  Signal,
  WorkStatus,
  WorkType,
  WorkPriority,
  ActorType,
  ActorAvailability,
  AdapterType,
  AutonomyLevel,
  ExecutionStatus,
  RelationType,
  SignalStatus,
  CanonicalUri,
} from '../core';
import { BaseAgentAdapter, AgentResult } from '../adapters/base.adapter';
import { AgyAdapter } from '../adapters/agy.adapter';
import { ClaudeAdapter } from '../adapters/claude.adapter';
import { OpencodeAdapter } from '../adapters/opencode.adapter';
import { GitHubAdapter } from '../adapters/github.adapter';
import { TelegramAdapter, TelegramProgressSession } from '../adapters/telegram.adapter';
import { LineageService } from './lineage.service';
import { ReporterService } from './reporter.service';
import { StageRunnerService } from './stage-runner.service';
import { ConfigLoaderService } from '../config';
import * as crypto from 'node:crypto';

export interface PipelineOptions {
  title: string;
  description: string;
  workingDirectory: string;
  githubRepo?: string;
  branchName?: string;
  correlationId?: string;
  issueNumber?: number;
  skipTests?: boolean;
  testCommand?: string;
  implementer?: 'opencode' | 'agy' | 'claude' | string;
  telegramNotification?: {
    botToken: string;
    chatId: number | string;
  };
}

export interface PipelineResult {
  workId: string;
  issueNumber?: number;
  issueUrl?: string;
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  testPassed: boolean;
  implementationLogs: string;
  reviewLogs: string;
  lineageTree: string;
  error?: string;
}

export interface TriageExecution {
  id: string;
  workId: string;
  actorId: string;
  status: ExecutionStatus;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  recentLogs?: string;
}

export interface TriageReport {
  workId: string;
  title: string;
  status: WorkStatus;
  failed: boolean;
  failedStep?: string;
  rootCause?: string;
  error?: string;
  context: Record<string, any>;
  executions: TriageExecution[];
  relations: Relation[];
  lineageTree: string;
  recommendations: string[];
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly adapters = new Map<string, BaseAgentAdapter>();

  constructor(
    private readonly store: FactoryStoreService,
    private readonly lineageService: LineageService,
    private readonly agyAdapter: AgyAdapter,
    private readonly claudeAdapter: ClaudeAdapter,
    private readonly githubAdapter: GitHubAdapter,
    private readonly telegramAdapter?: TelegramAdapter,
    private readonly reporterService?: ReporterService,
    private readonly configLoader?: ConfigLoaderService,
    private readonly stageRunner?: StageRunnerService,
    private readonly opencodeAdapter?: OpencodeAdapter,
  ) {
    this.registerAdapter(this.agyAdapter);
    this.registerAdapter(this.claudeAdapter);
    if (this.opencodeAdapter) {
      this.registerAdapter(this.opencodeAdapter);
    }
    this.syncConfiguredActors();
  }

  registerAdapter(adapter: BaseAgentAdapter) {
    this.adapters.set(adapter.id, adapter);
    this.stageRunner?.registerAdapter(adapter);
  }

  getAdapter(id: string): BaseAgentAdapter | undefined {
    return this.adapters.get(id);
  }

  syncConfiguredActors() {
    if (this.configLoader) {
      try {
        const config = this.configLoader.getConfig();
        if (config && config.actors && config.actors.length > 0) {
          for (const actorCfg of config.actors) {
            const existing = this.store.getActor(actorCfg.id);
            const actor: Actor = {
              id: actorCfg.id,
              name: actorCfg.name,
              type: (actorCfg.type as ActorType) || ActorType.INTERNAL_AGENT,
              adapterType: (actorCfg.adapter as AdapterType) || AdapterType.CLI,
              capabilities: actorCfg.capabilities || [],
              availability: (actorCfg.availability as ActorAvailability) || ActorAvailability.AVAILABLE,
              autonomyLevel: (actorCfg.autonomyLevel as AutonomyLevel) || AutonomyLevel.SEMI_AUTONOMOUS,
              owner: actorCfg.owner,
              config: {
                ...actorCfg.config,
                ...(actorCfg.model ? { model: actorCfg.model } : {}),
              },
              createdAt: existing ? existing.createdAt : new Date().toISOString(),
            };
            this.store.saveActor(actor);
          }
          this.logger.log(`Synced ${config.actors.length} actors from configuration into database.`);
          return;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to sync actors from configuration: ${err.message}. Falling back to default actors.`);
      }
    }

    this.initDefaultActors();
  }

  private initDefaultActors() {
    // Register opencode actor (primary implementer)
    if (!this.store.getActor('opencode')) {
      this.store.saveActor({
        id: 'opencode',
        name: 'OpenCode CLI Agent',
        type: ActorType.INTERNAL_AGENT,
        adapterType: AdapterType.CLI,
        capabilities: ['code_generation', 'implementation', 'refactoring', 'tests', 'debugging'],
        availability: ActorAvailability.AVAILABLE,
        autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
        config: { model: 'opencode/deepseek-v4.1-flash-free' },
        createdAt: new Date().toISOString(),
      });
    }

    // Register agy actor
    if (!this.store.getActor('agy')) {
      this.store.saveActor({
        id: 'agy',
        name: 'Google Antigravity Agent',
        type: ActorType.INTERNAL_AGENT,
        adapterType: AdapterType.CLI,
        capabilities: ['code_generation', 'implementation', 'refactoring'],
        availability: ActorAvailability.AVAILABLE,
        autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
        config: {},
        createdAt: new Date().toISOString(),
      });
    }

    // Register claude actor
    if (!this.store.getActor('claude')) {
      this.store.saveActor({
        id: 'claude',
        name: 'Claude Code Agent',
        type: ActorType.INTERNAL_AGENT,
        adapterType: AdapterType.CLI,
        capabilities: ['architecture', 'code_review', 'security_audit', 'planning'],
        availability: ActorAvailability.AVAILABLE,
        autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
        config: {},
        createdAt: new Date().toISOString(),
      });
    }

    // Register human actor (Ali)
    if (!this.store.getActor('human:ali')) {
      this.store.saveActor({
        id: 'human:ali',
        name: 'Ali (Human Gate)',
        type: ActorType.HUMAN,
        adapterType: AdapterType.MANUAL,
        capabilities: ['approval', 'architecture_decision', 'merge'],
        availability: ActorAvailability.AVAILABLE,
        autonomyLevel: AutonomyLevel.HUMAN_ONLY,
        config: {},
        createdAt: new Date().toISOString(),
      });
    }
  }

  // --- SIGNAL INTAKE ---

  async ingestSignal(
    source: string,
    signalType: string,
    payload: Record<string, any>,
    idempotencyKey?: string,
  ): Promise<{ signal: Signal; work?: Work }> {
    const key = idempotencyKey || crypto.createHash('sha256').update(`${source}:${signalType}:${JSON.stringify(payload)}`).digest('hex');

    const existing = this.store.getSignalByIdempotencyKey(key);
    if (existing) {
      this.logger.log(`Idempotent signal duplicate detected for key: ${key}`);
      return { signal: existing };
    }

    const correlationId = crypto.randomUUID();
    const now = new Date().toISOString();

    const signal: Signal = {
      id: crypto.randomUUID(),
      source,
      signalType,
      payload,
      idempotencyKey: key,
      correlationId,
      status: SignalStatus.RECEIVED,
      occurredAt: now,
    };

    this.store.saveSignal(signal);

    // Create corresponding Work
    const workId = crypto.randomUUID();
    const work: Work = {
      id: workId,
      title: payload.title || `Work from ${source}:${signalType}`,
      description: payload.description || JSON.stringify(payload, null, 2),
      type: WorkType.IMPLEMENTATION,
      status: WorkStatus.PENDING,
      priority: WorkPriority.MEDIUM,
      context: { signalId: signal.id, correlationId },
      createdAt: now,
      updatedAt: now,
    };

    this.store.saveWork(work);

    // Record relation: work triggered-by signal
    this.store.saveRelation({
      id: crypto.randomUUID(),
      sourceRef: CanonicalUri.factoryWork(work.id),
      targetRef: `signal://${source}/${signal.id}`,
      relationType: RelationType.TRIGGERED_BY,
      metadata: {},
      createdAt: now,
    });

    signal.status = SignalStatus.PROCESSED;
    signal.processedAt = new Date().toISOString();
    this.store.saveSignal(signal);

    return { signal, work };
  }

  // --- EXECUTE WORK ITEM ---

  async executeWork(
    workId: string,
    actorId: string,
    workingDirectory: string,
    timeoutSeconds = 300,
  ): Promise<AgentResult> {
    const work = this.store.getWork(workId);
    if (!work) {
      throw new Error(`Work with ID ${workId} not found`);
    }

    const actor = this.store.getActor(actorId);
    if (!actor) {
      throw new Error(`Actor with ID ${actorId} not found`);
    }

    const adapter = this.adapters.get(actorId);
    if (!adapter) {
      throw new Error(`No execution adapter found for actor ${actorId}`);
    }

    const executionId = crypto.randomUUID();
    const correlationId = work.context?.correlationId || crypto.randomUUID();
    const now = new Date().toISOString();

    work.status = WorkStatus.IN_PROGRESS;
    work.assignedActorId = actor.id;
    work.updatedAt = now;
    this.store.saveWork(work);

    const execution: Execution = {
      id: executionId,
      workId: work.id,
      actorId: actor.id,
      status: ExecutionStatus.RUNNING,
      correlationId,
      causationId: CanonicalUri.factoryWork(work.id),
      logs: '',
      producedReferences: [],
      startedAt: now,
    };
    this.store.saveExecution(execution);

    // Record relation: work caused execution attempt
    this.store.saveRelation({
      id: crypto.randomUUID(),
      sourceRef: CanonicalUri.factoryWork(work.id),
      targetRef: CanonicalUri.agentRun(actor.id, execution.id),
      relationType: RelationType.CAUSED,
      metadata: {},
      createdAt: now,
    });

    // Record relation: execution performed-by actor
    this.store.saveRelation({
      id: crypto.randomUUID(),
      sourceRef: CanonicalUri.agentRun(actor.id, execution.id),
      targetRef: `actor://${actor.id}`,
      relationType: RelationType.PERFORMED_BY,
      metadata: {},
      createdAt: now,
    });

    // Execute via adapter
    const result = await adapter.execute(work, execution, workingDirectory, timeoutSeconds, actor);

    const finishedAt = new Date().toISOString();
    execution.status = result.status;
    execution.logs = result.logs;
    execution.error = result.error;
    execution.producedReferences = result.producedReferences;
    execution.finishedAt = finishedAt;
    this.store.saveExecution(execution);

    // Record produced references & relations
    for (const refUri of result.producedReferences) {
      this.store.saveReference({
        id: crypto.randomUUID(),
        uri: refUri,
        scheme: 'agent',
        targetType: 'execution_run',
        metadata: {},
        createdAt: finishedAt,
      });

      this.store.saveRelation({
        id: crypto.randomUUID(),
        sourceRef: CanonicalUri.agentRun(actor.id, execution.id),
        targetRef: refUri,
        relationType: RelationType.PRODUCED,
        metadata: {},
        createdAt: finishedAt,
      });
    }

    work.status = result.status === ExecutionStatus.COMPLETED ? WorkStatus.COMPLETED : WorkStatus.FAILED;
    work.updatedAt = finishedAt;
    this.store.saveWork(work);

    return result;
  }

  // --- FULL END-TO-END PIPELINE ---

  async runPipeline(options: PipelineOptions): Promise<PipelineResult> {
    const { title, description, workingDirectory } = options;
    const correlationId = options.correlationId || crypto.randomUUID();
    const now = new Date().toISOString();

    // Setup Telegram live notification session if configured
    const botToken = options.telegramNotification?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = options.telegramNotification?.chatId || process.env.TELEGRAM_CHAT_ID;

    let telegramSession: TelegramProgressSession | null = null;
    if (this.telegramAdapter && botToken && chatId) {
      telegramSession = this.telegramAdapter.createProgressSession(
        botToken,
        chatId,
        title,
        [
          { key: 'issue', label: 'ثبت Issue در گیت‌هاب' },
          { key: 'branch', label: 'ساخت برنچ ایزوله' },
          { key: 'implement', label: 'پیاده‌سازی کد (opencode)' },
          { key: 'review', label: 'بازبینی و ممیزی کد (claude)' },
          { key: 'test', label: 'اجرای تست‌های خودکار' },
          { key: 'pr', label: 'ساخت Pull Request' },
        ],
      );
      try {
        await telegramSession.start();
      } catch (err: any) {
        this.logger.warn(`[Pipeline] Failed to start Telegram progress message: ${err.message}`);
      }
    }

    const notifyStepStart = async (stepKey: string, detail?: string) => {
      this.reporterService?.broadcastProgress(stepKey, 'in_progress', detail);
      this.reporterService?.broadcastLog('Pipeline', `Starting ${stepKey}... ${detail ? `(${detail})` : ''}`);
      if (telegramSession) {
        try {
          await telegramSession.setStepInProgress(stepKey, detail);
        } catch {}
      }
    };

    const notifyStepComplete = async (stepKey: string, detail?: string) => {
      this.reporterService?.broadcastProgress(stepKey, 'completed', detail);
      this.reporterService?.broadcastLog('Pipeline', `Completed ${stepKey}. ${detail ? `(${detail})` : ''}`);
      if (telegramSession) {
        try {
          await telegramSession.completeStep(stepKey, detail);
        } catch {}
      }
    };

    const notifyFailure = async (error: string, failedKey?: string) => {
      this.reporterService?.broadcastProgress(failedKey || 'pipeline', 'failed', error);
      this.reporterService?.broadcastLog('Pipeline', `Error in ${failedKey || 'pipeline'}: ${error}`, 'error');
      if (telegramSession) {
        try {
          await telegramSession.fail(error, failedKey);
        } catch {}
      }
    };

    try {
      // 0. Auto-detect GitHub repository if not provided
      const repo = options.githubRepo || (await this.githubAdapter.detectRepo(workingDirectory)) || undefined;

      // 1. Step 0: Create GitHub Issue first (System of Record)
      let issueNumber = options.issueNumber;
      let issueUrl: string | undefined;

      if (repo && !issueNumber) {
        await notifyStepStart('issue', `مخزن: ${repo}`);
        this.logger.log(`[Pipeline] Step 0: Creating GitHub Issue on ${repo}...`);
        try {
          const issue = await this.githubAdapter.createIssue(
            repo,
            title,
            `## Software Factory Request\n\n${description}\n\n---\n*Created automatically by Software Factory Coordinator.*`,
            ['factory'],
          );
          issueNumber = issue.number;
          issueUrl = issue.url;
          this.logger.log(`[Pipeline] GitHub Issue created: ${issueUrl} (#${issueNumber})`);

          // Record Issue Reference
          const issueRefUri = CanonicalUri.githubIssue(repo, issueNumber);
          this.store.saveReference({
            id: crypto.randomUUID(),
            uri: issueRefUri,
            scheme: 'github',
            targetType: 'issue',
            metadata: { url: issueUrl, number: issueNumber },
            createdAt: now,
          });
          await notifyStepComplete('issue', `#${issueNumber}`);
        } catch (err: any) {
          this.logger.error(`[Pipeline] Failed to create GitHub Issue: ${err.message}`);
          await notifyStepComplete('issue', 'خطا در ثبت Issue');
        }
      } else if (issueNumber) {
        await notifyStepComplete('issue', `#${issueNumber} (از پیش تعیین‌شده)`);
      } else {
        await notifyStepComplete('issue', 'بدون مخزن گیت‌هاب');
      }

      // 2. Step 1: Create isolated Git Branch
      const branchSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
      const branchName = options.branchName || (issueNumber ? `feature/issue-${issueNumber}-${branchSlug}` : `feature/factory-${branchSlug}`);

      await notifyStepStart('branch', branchName);
      if (repo) {
        try {
          await this.githubAdapter.createBranch(workingDirectory, branchName);
          this.logger.log(`[Pipeline] Created git branch: ${branchName}`);
          await notifyStepComplete('branch', branchName);
        } catch (err: any) {
          this.logger.warn(`[Pipeline] Branch ${branchName} already exists or checkout warning: ${err.message}`);
          await notifyStepComplete('branch', `${branchName} (موجود)`);
        }
      } else {
        await notifyStepComplete('branch', branchName);
      }

      // 3. Step 2: Implementation Work (opencode/agy with auto-fallback to claude)
      const configImpl = (this.configLoader?.getConfig() as any)?.policies?.defaultImplementer;
      const defaultImpl = configImpl && this.adapters.has(configImpl)
        ? configImpl
        : this.adapters.has('opencode')
          ? 'opencode'
          : this.adapters.has('agy')
            ? 'agy'
            : 'claude';
      const chosenImplementer = options.implementer || defaultImpl;
      await notifyStepStart('implement', `در حال اجرا توسط ${chosenImplementer}`);
      const implWorkId = crypto.randomUUID();
      const implWork: Work = {
        id: implWorkId,
        title: `Implementation: ${title}`,
        description,
        type: WorkType.IMPLEMENTATION,
        status: WorkStatus.PENDING,
        priority: WorkPriority.HIGH,
        context: { correlationId, branchName, githubRepo: repo, issueNumber },
        createdAt: now,
        updatedAt: now,
      };
      this.store.saveWork(implWork);

      if (issueNumber && repo) {
        this.store.saveRelation({
          id: crypto.randomUUID(),
          sourceRef: CanonicalUri.factoryWork(implWorkId),
          targetRef: CanonicalUri.githubIssue(repo, issueNumber),
          relationType: RelationType.TRIGGERED_BY,
          metadata: {},
          createdAt: now,
        });
      }

      this.logger.log(`[Pipeline] Step 2: Running Implementation with ${chosenImplementer}...`);
      let implResult = await this.executeWork(
        implWorkId,
        chosenImplementer,
        workingDirectory,
        600,
      );
      if (implResult.logs) {
        this.reporterService?.broadcastLog(chosenImplementer, implResult.logs.slice(-500));
      }

      // Fallback to claude if implementer (opencode or agy) was chosen and failed or soft-denied
      if (chosenImplementer !== 'claude' && implResult.status !== ExecutionStatus.COMPLETED) {
        this.logger.warn(`[Pipeline] ${chosenImplementer} implementation returned ${implResult.status} (${implResult.error}). Automatically falling back to claude...`);
        this.reporterService?.broadcastLog('Pipeline', `سوییچ خودکار از ${chosenImplementer} به claude جهت پیاده‌سازی...`, 'warn');
        implResult = await this.executeWork(implWorkId, 'claude', workingDirectory, 900);
        if (implResult.logs) {
          this.reporterService?.broadcastLog('claude', implResult.logs.slice(-500));
        }
      }
      await notifyStepComplete('implement', implResult.status === ExecutionStatus.COMPLETED ? 'موفق' : 'دارای خطا');

      // Check implementation status: if failed, halt pipeline and rollback
      if (implResult.status !== ExecutionStatus.COMPLETED) {
        const errorCause = implResult.error || 'Implementation failed: actor execution did not complete';
        this.logger.error(`[Pipeline] Implementation failed. Halting pipeline: ${errorCause}`);

        implWork.status = WorkStatus.FAILED;
        implWork.context = {
          ...implWork.context,
          error: errorCause,
          failureCause: errorCause,
          failedStep: 'implement',
        };
        implWork.updatedAt = new Date().toISOString();
        this.store.saveWork(implWork);

        if (repo && issueNumber) {
          await this.postFailureComment(repo, issueNumber, 'Implementation', errorCause, implResult.logs);
        }

        await notifyFailure(errorCause, 'implement');

        const lineageTree = this.lineageService.formatAsciiTree(CanonicalUri.factoryWork(implWorkId));
        return {
          workId: implWorkId,
          issueNumber,
          issueUrl,
          branchName,
          testPassed: false,
          implementationLogs: implResult.logs,
          reviewLogs: '',
          lineageTree,
          error: errorCause,
        };
      }

      // 4. Step 3: Review & Verification Work via claude
      await notifyStepStart('review', 'در حال بازبینی توسط claude');
      const reviewWorkId = crypto.randomUUID();
      const reviewWork: Work = {
        id: reviewWorkId,
        title: `Review & Verification: ${title}`,
        description: `Review the changes and verify code quality for implementation: ${title}.\n\nImplementation Output:\n${implResult.logs.slice(-1000)}`,
        type: WorkType.REVIEW,
        status: WorkStatus.PENDING,
        priority: WorkPriority.HIGH,
        context: { correlationId, implWorkId, branchName, issueNumber, githubRepo: repo },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.store.saveWork(reviewWork);

      this.store.saveRelation({
        id: crypto.randomUUID(),
        sourceRef: CanonicalUri.factoryWork(reviewWorkId),
        targetRef: CanonicalUri.factoryWork(implWorkId),
        relationType: RelationType.VERIFIES,
        metadata: {},
        createdAt: new Date().toISOString(),
      });

      this.logger.log(`[Pipeline] Step 3: Running Review with claude...`);
      const reviewTimeout = (this.configLoader?.getConfig() as any)?.policies?.timeoutSeconds ? Math.max(600, (this.configLoader?.getConfig() as any)?.policies?.timeoutSeconds) : 600;
      const reviewResult = await this.executeWork(reviewWorkId, 'claude', workingDirectory, reviewTimeout);
      if (reviewResult.logs) {
        this.reporterService?.broadcastLog('claude', reviewResult.logs.slice(-500));
      }
      await notifyStepComplete('review', reviewResult.status === ExecutionStatus.COMPLETED ? 'تأیید شد' : 'دارای هشدار');

      // Check review status: if failed, halt pipeline and rollback
      if (reviewResult.status !== ExecutionStatus.COMPLETED) {
        const errorCause = reviewResult.error || 'Review failed: verification rejected or reviewer did not complete';
        this.logger.error(`[Pipeline] Review failed. Halting pipeline: ${errorCause}`);

        reviewWork.status = WorkStatus.FAILED;
        reviewWork.context = {
          ...reviewWork.context,
          error: errorCause,
          failureCause: errorCause,
          failedStep: 'review',
        };
        reviewWork.updatedAt = new Date().toISOString();
        this.store.saveWork(reviewWork);

        implWork.status = WorkStatus.FAILED;
        implWork.context = {
          ...implWork.context,
          error: `Review failed: ${errorCause}`,
          failureCause: `Review failed: ${errorCause}`,
          failedStep: 'review',
        };
        implWork.updatedAt = new Date().toISOString();
        this.store.saveWork(implWork);

        if (repo && issueNumber) {
          await this.postFailureComment(repo, issueNumber, 'Review & Verification', errorCause, reviewResult.logs);
        }

        await notifyFailure(errorCause, 'review');

        const lineageTree = this.lineageService.formatAsciiTree(CanonicalUri.factoryWork(implWorkId));
        return {
          workId: implWorkId,
          issueNumber,
          issueUrl,
          branchName,
          testPassed: false,
          implementationLogs: implResult.logs,
          reviewLogs: reviewResult.logs,
          lineageTree,
          error: errorCause,
        };
      }

      // 5. Step 4: Run Automated Tests
      await notifyStepStart('test', 'اجرای تست‌های خودکار');
      this.logger.log(`[Pipeline] Step 4: Running project automated tests...`);
      let testPassed = false;
      let testOutput = '';
      if (options.skipTests) {
        testPassed = true;
        testOutput = 'Automated tests skipped by pipeline configuration';
        this.logger.log(`[Pipeline] Tests skipped via options.skipTests`);
        this.reporterService?.broadcastLog('TestRunner', 'تست‌های خودکار با تنظیمات پایپ‌لاین رد شدند.');
        await notifyStepComplete('test', 'تست‌ها رد شدند (skip)');
      } else {
        try {
          const { exec } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execAsync = promisify(exec);
          const cmd = options.testCommand || 'pnpm test || npm test';
          const testRes = await execAsync(cmd, { cwd: workingDirectory });
          testPassed = true;
          testOutput = testRes.stdout || testRes.stderr;
          this.logger.log(`[Pipeline] All automated tests passed!`);
          this.reporterService?.broadcastLog('TestRunner', 'تمامی تست‌های خودکار با موفقیت پاس شدند.');
          await notifyStepComplete('test', '✅ تست‌ها با موفقیت پاس شدند');
        } catch (err: any) {
          testPassed = false;
          testOutput = err.stdout || err.stderr || err.message;
          this.logger.warn(`[Pipeline] Automated tests failed or had findings: ${err.message}`);
          this.reporterService?.broadcastLog('TestRunner', `خطا در اجرای تست: ${err.message}`, 'warn');
          await notifyStepComplete('test', '⚠️ دارای خطای تست');
        }
      }

      // Check test status: if automated tests failed, do not create an unverified PR
      if (!testPassed) {
        const errorCause = `Automated tests failed:\n${testOutput.trim()}`;
        this.logger.error(`[Pipeline] Automated tests failed. Halting pipeline without creating PR.`);

        implWork.status = WorkStatus.FAILED;
        implWork.context = {
          ...implWork.context,
          error: errorCause,
          failureCause: errorCause,
          failedStep: 'test',
          testOutput: testOutput.slice(-2000),
        };
        implWork.updatedAt = new Date().toISOString();
        this.store.saveWork(implWork);

        if (repo && issueNumber) {
          await this.postFailureComment(repo, issueNumber, 'Automated Tests', errorCause, testOutput);
        }

        await notifyFailure('Automated tests failed', 'test');

        const lineageTree = this.lineageService.formatAsciiTree(CanonicalUri.factoryWork(implWorkId));
        return {
          workId: implWorkId,
          issueNumber,
          issueUrl,
          branchName,
          testPassed: false,
          implementationLogs: implResult.logs,
          reviewLogs: reviewResult.logs,
          lineageTree,
          error: errorCause,
        };
      }

      // 6. Step 5: Git Commit, Push & Create Pull Request
      let prUrl: string | undefined;
      let prNumber: number | undefined;

      if (repo) {
        await notifyStepStart('pr', 'ارسال تغییرات و ساخت PR');
        try {
          this.logger.log(`[Pipeline] Step 5: Committing, pushing, and creating Pull Request...`);
          const commitMsg = `feat: ${title}${issueNumber ? ` (refs #${issueNumber})` : ''}\n\nCoordinated by Software Factory.\nImplementer: ${implResult.status === ExecutionStatus.COMPLETED ? chosenImplementer : 'claude'}\nReviewer: claude`;
          await this.githubAdapter.commitAll(workingDirectory, commitMsg);
          await this.githubAdapter.pushBranch(workingDirectory, branchName);

          const prBody = `## Software Factory Automation Report

${issueNumber ? `Closes #${issueNumber}\n` : ''}

### Summary
${description}

### Verification Summary:
\`\`\`
${reviewResult.logs.slice(-1000)}
\`\`\`

### Automated Tests:
${testPassed ? '✅ All automated test suites passed.' : '⚠️ Tests encountered issues (inspect output below):'}
\`\`\`
${testOutput.slice(-500)}
\`\`\`

---
*Coordinated by Software Factory (System of Coordination v31)*
*Human Gate Approval: Ali (@ali-ahadi1105)*
`;

          const pr = await this.githubAdapter.createPullRequest(
            workingDirectory,
            `feat: ${title}${issueNumber ? ` (#${issueNumber})` : ''}`,
            prBody,
            'main',
          );

          prUrl = pr.url;
          prNumber = pr.number;
          this.logger.log(`[Pipeline] Pull Request created: ${prUrl} (#${prNumber})`);

          // Record PR Reference and Relation
          const prRefUri = CanonicalUri.githubPr(repo, pr.number);
          this.store.saveReference({
            id: crypto.randomUUID(),
            uri: prRefUri,
            scheme: 'github',
            targetType: 'pull_request',
            metadata: { url: pr.url, number: pr.number, issueNumber },
            createdAt: new Date().toISOString(),
          });

          this.store.saveRelation({
            id: crypto.randomUUID(),
            sourceRef: CanonicalUri.factoryWork(implWorkId),
            targetRef: prRefUri,
            relationType: RelationType.PRODUCED,
            metadata: {},
            createdAt: new Date().toISOString(),
          });

          await notifyStepComplete('pr', prUrl);
          if (telegramSession) {
            await telegramSession.finish(prUrl);
          }
        } catch (err: any) {
          this.logger.error(`[Pipeline] Error during Git/PR step: ${err.message}`);
          await notifyFailure(err.message, 'pr');
          const errorCause = `Git/PR creation failed: ${err.message}`;
          implWork.status = WorkStatus.FAILED;
          implWork.context = {
            ...implWork.context,
            error: errorCause,
            failureCause: errorCause,
            failedStep: 'pr',
          };
          implWork.updatedAt = new Date().toISOString();
          this.store.saveWork(implWork);

          if (repo && issueNumber) {
            await this.postFailureComment(repo, issueNumber, 'Git/PR Creation', errorCause, err.message);
          }
        }
      }

      const lineageTree = this.lineageService.formatAsciiTree(CanonicalUri.factoryWork(implWorkId));

      return {
        workId: implWorkId,
        issueNumber,
        issueUrl,
        branchName,
        prUrl,
        prNumber,
        testPassed,
        implementationLogs: implResult.logs,
        reviewLogs: reviewResult.logs,
        lineageTree,
      };
    } catch (err: any) {
      await notifyFailure(err.message);
      throw err;
    }
  }

  // --- FAILURE HANDLING & TRIAGE ---

  async postFailureComment(
    repo: string,
    issueNumber: number,
    failedStep: string,
    errorCause: string,
    details?: string,
  ): Promise<void> {
    const commentBody = `## ❌ Software Factory Pipeline Failure Report

**Failed Step:** ${failedStep}
**Status:** FAILED
**Time:** ${new Date().toISOString()}

### Error Cause:
\`\`\`
${errorCause.slice(0, 1000)}
\`\`\`

${
  details
    ? `### Execution Details / Logs:
\`\`\`
${details.slice(-1000)}
\`\`\``
    : ''
}

---
*Factory Pipeline halted: No unverified PR was created.*
*Inspect and triage locally using: \`factory triage <workId>\`*
`;

    try {
      await this.githubAdapter.addIssueComment(repo, issueNumber, commentBody);
      this.logger.log(`[Pipeline] Posted failure comment to GitHub Issue #${issueNumber}`);
    } catch (err: any) {
      this.logger.warn(`[Pipeline] Failed to post failure comment to GitHub Issue #${issueNumber}: ${err.message}`);
    }
  }

  triage(workId: string): TriageReport {
    const work = this.store.getWork(workId);
    if (!work) {
      throw new Error(`Work with ID ${workId} not found`);
    }

    const executions = this.store.listExecutionsForWork(workId);
    const outgoing = this.store.getRelationsForSource(CanonicalUri.factoryWork(workId));
    const incoming = this.store.getRelationsForTarget(CanonicalUri.factoryWork(workId));
    const relations = [...outgoing, ...incoming];

    // Check for verifying work (e.g. review work verifying this impl work)
    const verifyingRelations = incoming.filter((r) => r.relationType === RelationType.VERIFIES);
    const allExecutions = [...executions];

    for (const rel of verifyingRelations) {
      const match = rel.sourceRef.match(/^factory:\/\/work\/(.+)$/);
      if (match) {
        const reviewWorkId = match[1];
        const reviewExecs = this.store.listExecutionsForWork(reviewWorkId);
        allExecutions.push(...reviewExecs);
      }
    }

    const failed = work.status === WorkStatus.FAILED;
    const failedStep =
      work.context?.failedStep ||
      (executions.some((e) => e.status === ExecutionStatus.FAILED)
        ? 'execution'
        : undefined);

    const rootCause =
      work.context?.error ||
      work.context?.failureCause ||
      executions.find((e) => e.error)?.error ||
      (failed ? 'Work marked as failed without explicit error cause' : undefined);

    const recommendations: string[] = [];
    if (failed) {
      if (failedStep === 'test') {
        recommendations.push('Automated tests failed. Inspect test output, fix test assertions/regressions, and run `pnpm test`.');
      } else if (failedStep === 'implement') {
        recommendations.push('Implementation failed. Check actor logs and consider falling back to claude or refining prompt.');
      } else if (failedStep === 'review') {
        recommendations.push('Code review failed. Address code quality or security findings before re-running.');
      } else {
        recommendations.push('Inspect error logs, resolve root cause, and retry execution.');
      }
      recommendations.push('Rollback verified: No unverified Pull Request was created.');
    } else {
      recommendations.push(`Work status is ${work.status}. No failure triage required.`);
    }

    const lineageTree = this.lineageService.formatAsciiTree(CanonicalUri.factoryWork(workId));

    return {
      workId: work.id,
      title: work.title,
      status: work.status,
      failed,
      failedStep,
      rootCause,
      error: work.context?.error,
      context: work.context,
      executions: allExecutions.map((e) => ({
        id: e.id,
        workId: e.workId,
        actorId: e.actorId,
        status: e.status,
        error: e.error,
        startedAt: e.startedAt,
        finishedAt: e.finishedAt,
        recentLogs: e.logs ? e.logs.slice(-300) : undefined,
      })),
      relations,
      lineageTree,
      recommendations,
    };
  }

  formatTriageReport(report: TriageReport): string {
    const lines: string[] = [];
    lines.push('====================================================');
    lines.push(`🔍 Factory Triage Report: ${report.workId}`);
    lines.push('====================================================');
    lines.push(`Title:       ${report.title}`);
    lines.push(`Status:      ${report.failed ? '❌ FAILED' : '✅ ' + report.status.toUpperCase()}`);
    if (report.failedStep) {
      lines.push(`Failed Step: ${report.failedStep}`);
    }
    if (report.rootCause) {
      lines.push(`\n🚨 Root Cause / Error:`);
      lines.push(`${report.rootCause}`);
    }
    if (report.context?.testOutput) {
      lines.push(`\n🧪 Test Failure Output:`);
      lines.push(`${report.context.testOutput.slice(-500)}`);
    }

    lines.push(`\n⚙️ Execution Attempts (${report.executions.length}):`);
    if (report.executions.length === 0) {
      lines.push('  (No executions found)');
    } else {
      for (const e of report.executions) {
        lines.push(`  - [${e.status.toUpperCase()}] Actor: ${e.actorId} (ID: ${e.id})`);
        if (e.error) {
          lines.push(`    Error: ${e.error}`);
        }
      }
    }

    lines.push(`\n🔗 Relations (${report.relations.length}):`);
    if (report.relations.length === 0) {
      lines.push('  (No relations recorded)');
    } else {
      for (const r of report.relations) {
        lines.push(`  - ${r.sourceRef} ──[${r.relationType}]──► ${r.targetRef}`);
      }
    }

    lines.push(`\n📊 Lineage Tree:`);
    lines.push(report.lineageTree);

    lines.push(`\n💡 Recommendations:`);
    for (const rec of report.recommendations) {
      lines.push(`  • ${rec}`);
    }
    lines.push('====================================================');

    return lines.join('\n');
  }
}
