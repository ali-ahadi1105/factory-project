import { Injectable, Logger } from '@nestjs/common';
import { FactoryStoreService } from '../store';
import { LineageService } from './lineage.service';
import { ReporterService } from './reporter.service';
import {
  Work,
  Actor,
  Execution,
  WorkStatus,
  WorkType,
  WorkPriority,
  ExecutionStatus,
  RelationType,
  CanonicalUri,
} from '../core';
import { WorkflowStage, FactoryConfig } from '../config';
import { BaseAgentAdapter, AgentResult } from '../adapters';
import * as crypto from 'node:crypto';

export interface StageExecutionOptions {
  pipelineTitle: string;
  pipelineDescription: string;
  workingDirectory: string;
  correlationId: string;
  issueNumber?: number;
  githubRepo?: string;
  branchName?: string;
  parentWorkId?: string;
  initialContext?: Record<string, any>;
  onStageStart?: (stageName: string, detail?: string) => Promise<void>;
  onStageComplete?: (stageName: string, detail?: string) => Promise<void>;
  onStageFailure?: (stageName: string, error: string) => Promise<void>;
}

export interface StageRunResult {
  stageName: string;
  workId: string;
  actorId?: string;
  status: ExecutionStatus | 'skipped' | 'paused';
  logs: string;
  error?: string;
  producedReferences: string[];
  executionTimeMs: number;
  gateEncountered?: string;
}

export interface PipelineExecutionResult {
  success: boolean;
  stagesExecuted: StageRunResult[];
  failedStage?: StageRunResult;
  lastWorkId?: string;
  finalOutput: string;
}

@Injectable()
export class StageRunnerService {
  private readonly logger = new Logger(StageRunnerService.name);
  private readonly adapters = new Map<string, BaseAgentAdapter>();

  constructor(
    private readonly store: FactoryStoreService,
    private readonly lineageService: LineageService,
    private readonly reporterService?: ReporterService,
  ) {}

  registerAdapter(adapter: BaseAgentAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  getAdapter(id: string): BaseAgentAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Run stages dynamically as specified in Factory configuration.
   */
  async runStages(
    stages: WorkflowStage[],
    options: StageExecutionOptions,
  ): Promise<PipelineExecutionResult> {
    const {
      pipelineTitle,
      pipelineDescription,
      workingDirectory,
      correlationId,
      issueNumber,
      githubRepo,
      branchName,
    } = options;

    const stagesExecuted: StageRunResult[] = [];
    let previousWorkId: string | undefined = options.parentWorkId;
    let accumulatedContext: Record<string, any> = { ...(options.initialContext || {}) };
    let accumulatedLogs = '';

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const stageName = stage.name;
      const startTime = Date.now();

      this.logger.log(`[StageRunner] Starting stage ${i + 1}/${stages.length}: "${stageName}"...`);
      await options.onStageStart?.(stageName, `گام: ${stage.description || stageName}`);

      // Handle Human Gate
      if (stage.gate === 'human_approval' || stage.gate === 'mandatory') {
        this.logger.log(`[StageRunner] Stage "${stageName}" requires human approval (gate: ${stage.gate}).`);
        const approvalWorkId = crypto.randomUUID();
        const now = new Date().toISOString();

        const approvalWork: Work = {
          id: approvalWorkId,
          title: `Approval: ${pipelineTitle} (${stageName})`,
          description: `Human gate approval required for stage ${stageName}.\n\nPreceding Output:\n${accumulatedLogs.slice(-1000)}`,
          type: WorkType.APPROVAL,
          status: WorkStatus.PENDING,
          priority: WorkPriority.CRITICAL,
          context: {
            correlationId,
            stage: stageName,
            gate: stage.gate,
            previousWorkId,
          },
          createdAt: now,
          updatedAt: now,
        };
        this.store.saveWork(approvalWork);

        if (previousWorkId) {
          this.store.saveRelation({
            id: crypto.randomUUID(),
            sourceRef: CanonicalUri.factoryWork(approvalWorkId),
            targetRef: CanonicalUri.factoryWork(previousWorkId),
            relationType: RelationType.DEPENDS_ON,
            metadata: { stage: stageName, gate: stage.gate },
            createdAt: now,
          });
        }

        const gateResult: StageRunResult = {
          stageName,
          workId: approvalWorkId,
          actorId: 'human:ali',
          status: 'paused',
          logs: `Human approval gate reached at stage "${stageName}". Work item created for approval.`,
          producedReferences: [CanonicalUri.factoryWork(approvalWorkId)],
          executionTimeMs: Date.now() - startTime,
          gateEncountered: stage.gate,
        };
        stagesExecuted.push(gateResult);
        await options.onStageComplete?.(stageName, 'منتظر تأیید کاربر (Gate: Human Approval)');

        // We pause the automated pipeline at human approval
        return {
          success: true,
          stagesExecuted,
          lastWorkId: approvalWorkId,
          finalOutput: accumulatedLogs,
        };
      }

      // If no actor defined for stage, treat as procedural step or skip
      if (!stage.actor) {
        this.logger.log(`[StageRunner] Stage "${stageName}" has no actor specified. Completed as procedural step.`);
        const proceduralResult: StageRunResult = {
          stageName,
          workId: previousWorkId || crypto.randomUUID(),
          status: 'skipped',
          logs: `Procedural stage "${stageName}" finished without agent execution.`,
          producedReferences: [],
          executionTimeMs: Date.now() - startTime,
        };
        stagesExecuted.push(proceduralResult);
        await options.onStageComplete?.(stageName, 'مرحله رویه‌ای تکمیل شد');
        continue;
      }

      // Agent-driven stage execution
      const actor = this.store.getActor(stage.actor);
      const adapter = this.adapters.get(stage.actor);

      if (!adapter) {
        const errorMsg = `No adapter registered for actor "${stage.actor}" in stage "${stageName}"`;
        this.logger.error(`[StageRunner] ${errorMsg}`);
        await options.onStageFailure?.(stageName, errorMsg);

        const failResult: StageRunResult = {
          stageName,
          workId: crypto.randomUUID(),
          actorId: stage.actor,
          status: ExecutionStatus.FAILED,
          logs: '',
          error: errorMsg,
          producedReferences: [],
          executionTimeMs: Date.now() - startTime,
        };
        stagesExecuted.push(failResult);

        return {
          success: false,
          stagesExecuted,
          failedStage: failResult,
          finalOutput: accumulatedLogs,
        };
      }

      // Create Work item for this stage
      const stageWorkId = crypto.randomUUID();
      const now = new Date().toISOString();
      const stageType = this.mapStageType(stageName);

      const stagePrompt = `Task: ${pipelineTitle} [Stage: ${stageName}]
Description: ${stage.description || pipelineDescription}
Work ID: ${stageWorkId}
${accumulatedLogs ? `\nPreceding Stages Context & Logs:\n${accumulatedLogs.slice(-1500)}` : ''}`;

      const stageWork: Work = {
        id: stageWorkId,
        title: `${stageName.toUpperCase()}: ${pipelineTitle}`,
        description: stagePrompt,
        type: stageType,
        status: WorkStatus.PENDING,
        priority: WorkPriority.HIGH,
        assignedActorId: actor?.id,
        context: {
          correlationId,
          stage: stageName,
          previousWorkId,
          githubRepo,
          branchName,
          issueNumber,
          model: stage.config?.model || actor?.model,
          ...accumulatedContext,
        },
        createdAt: now,
        updatedAt: now,
      };
      this.store.saveWork(stageWork);

      // Record causal relation to previous work (depends-on or verifies)
      if (previousWorkId) {
        const relationType = stageType === WorkType.REVIEW || stageType === WorkType.TEST
          ? RelationType.VERIFIES
          : RelationType.DEPENDS_ON;

        this.store.saveRelation({
          id: crypto.randomUUID(),
          sourceRef: CanonicalUri.factoryWork(stageWorkId),
          targetRef: CanonicalUri.factoryWork(previousWorkId),
          relationType,
          metadata: { stage: stageName },
          createdAt: now,
        });
      }

      // Execute work via adapter
      const executionId = crypto.randomUUID();
      const execution: Execution = {
        id: executionId,
        workId: stageWorkId,
        actorId: stage.actor,
        status: ExecutionStatus.RUNNING,
        correlationId,
        causationId: previousWorkId ? CanonicalUri.factoryWork(previousWorkId) : CanonicalUri.factoryWork(stageWorkId),
        logs: '',
        producedReferences: [],
        startedAt: now,
      };
      this.store.saveExecution(execution);

      // Record performed-by relation
      this.store.saveRelation({
        id: crypto.randomUUID(),
        sourceRef: CanonicalUri.agentRun(stage.actor, execution.id),
        targetRef: `actor://${stage.actor}`,
        relationType: RelationType.PERFORMED_BY,
        metadata: {},
        createdAt: now,
      });

      const timeout = stage.timeoutSeconds || 300;
      const agentResult = await adapter.execute(stageWork, execution, workingDirectory, timeout, actor || undefined);

      const finishedAt = new Date().toISOString();
      execution.status = agentResult.status;
      execution.logs = agentResult.logs;
      execution.error = agentResult.error;
      execution.producedReferences = agentResult.producedReferences;
      execution.finishedAt = finishedAt;
      this.store.saveExecution(execution);

      for (const refUri of agentResult.producedReferences) {
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
          sourceRef: CanonicalUri.agentRun(stage.actor, execution.id),
          targetRef: refUri,
          relationType: RelationType.PRODUCED,
          metadata: {},
          createdAt: finishedAt,
        });
      }

      const stageSucceeded = agentResult.status === ExecutionStatus.COMPLETED;
      stageWork.status = stageSucceeded ? WorkStatus.COMPLETED : WorkStatus.FAILED;
      stageWork.updatedAt = finishedAt;
      this.store.saveWork(stageWork);

      const stageDuration = Date.now() - startTime;
      const stageResult: StageRunResult = {
        stageName,
        workId: stageWorkId,
        actorId: stage.actor,
        status: agentResult.status,
        logs: agentResult.logs,
        error: agentResult.error,
        producedReferences: agentResult.producedReferences,
        executionTimeMs: stageDuration,
      };
      stagesExecuted.push(stageResult);

      if (agentResult.logs) {
        accumulatedLogs += `\n[Stage: ${stageName}]\n${agentResult.logs}\n`;
      }

      if (!stageSucceeded) {
        this.logger.error(`[StageRunner] Stage "${stageName}" failed: ${agentResult.error || 'Unknown error'}`);
        await options.onStageFailure?.(stageName, agentResult.error || 'Execution failed');

        if (stage.required !== false) {
          return {
            success: false,
            stagesExecuted,
            failedStage: stageResult,
            lastWorkId: stageWorkId,
            finalOutput: accumulatedLogs,
          };
        }
      } else {
        await options.onStageComplete?.(stageName, `${(stageDuration / 1000).toFixed(1)}s`);
      }

      previousWorkId = stageWorkId;
    }

    return {
      success: true,
      stagesExecuted,
      lastWorkId: previousWorkId,
      finalOutput: accumulatedLogs,
    };
  }

  private mapStageType(stageName: string): WorkType {
    const s = stageName.toLowerCase();
    if (s.includes('plan')) return WorkType.PLANNING;
    if (s.includes('review') || s.includes('audit')) return WorkType.REVIEW;
    if (s.includes('test')) return WorkType.TEST;
    if (s.includes('deploy')) return WorkType.DEPLOY;
    if (s.includes('approval')) return WorkType.APPROVAL;
    return WorkType.IMPLEMENTATION;
  }
}
