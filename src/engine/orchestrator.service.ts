import { Injectable, Logger } from '@nestjs/common';
import { FactoryStoreService } from '../store';
import {
  Work,
  Actor,
  Execution,
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
import { GitHubAdapter } from '../adapters/github.adapter';
import { LineageService } from './lineage.service';
import * as crypto from 'node:crypto';

export interface PipelineOptions {
  title: string;
  description: string;
  workingDirectory: string;
  githubRepo?: string;
  branchName?: string;
  correlationId?: string;
}

export interface PipelineResult {
  workId: string;
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  implementationLogs: string;
  reviewLogs: string;
  lineageTree: string;
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
  ) {
    this.registerAdapter(this.agyAdapter);
    this.registerAdapter(this.claudeAdapter);
    this.initDefaultActors();
  }

  registerAdapter(adapter: BaseAgentAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  getAdapter(id: string): BaseAgentAdapter | undefined {
    return this.adapters.get(id);
  }

  private initDefaultActors() {
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
    const result = await adapter.execute(work, execution, workingDirectory, timeoutSeconds);

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
    const { title, description, workingDirectory, githubRepo } = options;
    const correlationId = options.correlationId || crypto.randomUUID();
    const branchName = options.branchName || `feature/factory-${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    this.logger.log(`Starting Software Factory Pipeline for "${title}" on branch ${branchName}...`);

    // 1. Create Git branch if GitHub repo configured
    if (githubRepo) {
      try {
        await this.githubAdapter.createBranch(workingDirectory, branchName);
        this.logger.log(`Created git branch: ${branchName}`);
      } catch (err: any) {
        this.logger.warn(`Could not create branch ${branchName} (might already exist): ${err.message}`);
      }
    }

    // 2. Step 1: Implementation Work via agy
    const implWorkId = crypto.randomUUID();
    const implWork: Work = {
      id: implWorkId,
      title: `Implementation: ${title}`,
      description,
      type: WorkType.IMPLEMENTATION,
      status: WorkStatus.PENDING,
      priority: WorkPriority.HIGH,
      context: { correlationId, branchName, githubRepo },
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveWork(implWork);

    this.logger.log(`Step 1: Running Implementation with agy...`);
    const implResult = await this.executeWork(implWorkId, 'agy', workingDirectory, 360);

    // 3. Step 2: Code Review & Verification Work via claude
    const reviewWorkId = crypto.randomUUID();
    const reviewWork: Work = {
      id: reviewWorkId,
      title: `Review & Verification: ${title}`,
      description: `Review the changes and verify code quality for implementation: ${title}.\nImplementation Logs:\n${implResult.logs.slice(-1000)}`,
      type: WorkType.REVIEW,
      status: WorkStatus.PENDING,
      priority: WorkPriority.HIGH,
      context: { correlationId, implWorkId, branchName },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.store.saveWork(reviewWork);

    // Record relation: review-work verifies implementation-work
    this.store.saveRelation({
      id: crypto.randomUUID(),
      sourceRef: CanonicalUri.factoryWork(reviewWorkId),
      targetRef: CanonicalUri.factoryWork(implWorkId),
      relationType: RelationType.VERIFIES,
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    this.logger.log(`Step 2: Running Review with claude...`);
    const reviewResult = await this.executeWork(reviewWorkId, 'claude', workingDirectory, 300);

    // 4. Step 3: Git Commit and Pull Request (if GitHub configured)
    let prUrl: string | undefined;
    let prNumber: number | undefined;

    if (githubRepo) {
      try {
        this.logger.log(`Step 3: Committing and creating Pull Request...`);
        const commitSha = await this.githubAdapter.commitAll(
          workingDirectory,
          `feat: ${title}\n\nCoordinated by Software Factory.\nImplementer: agy (Gemini 3.8 Flash)\nReviewer: claude (Thinking)`,
        );

        await this.githubAdapter.pushBranch(workingDirectory, branchName);

        const prBody = `## Software Factory Automation Report

**Title:** ${title}
**Status:** Ready for Human Gate Review & Approval

### Agents Involved:
- **Implementer:** \`agy\` (Gemini 3.8 Flash)
- **Reviewer:** \`claude\` (Claude Code Thinking)
- **Human Gate:** Ali (@ali-ahadi1105)

### Verification Summary:
\`\`\`
${reviewResult.logs.slice(-500)}
\`\`\`

---
*Coordinated by Software Factory (System of Coordination v31)*
`;

        const pr = await this.githubAdapter.createPullRequest(
          workingDirectory,
          `[Factory] ${title}`,
          prBody,
          'main',
        );

        prUrl = pr.url;
        prNumber = pr.number;
        this.logger.log(`Pull Request created: ${prUrl}`);

        // Record PR Reference and Relation
        const prRefUri = CanonicalUri.githubPr(githubRepo, pr.number);
        this.store.saveReference({
          id: crypto.randomUUID(),
          uri: prRefUri,
          scheme: 'github',
          targetType: 'pull_request',
          metadata: { url: pr.url, number: pr.number },
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
      } catch (err: any) {
        this.logger.error(`Error during Git/PR step: ${err.message}`);
      }
    }

    const lineageTree = this.lineageService.formatAsciiTree(CanonicalUri.factoryWork(implWorkId));

    return {
      workId: implWorkId,
      branchName,
      prUrl,
      prNumber,
      implementationLogs: implResult.logs,
      reviewLogs: reviewResult.logs,
      lineageTree,
    };
  }
}
