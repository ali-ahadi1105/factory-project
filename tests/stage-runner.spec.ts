import { DatabaseService, FactoryStoreService } from '../src/store';
import { LineageService, StageRunnerService, ReporterService } from '../src/engine';
import { MockAgentAdapter } from '../src/adapters';
import {
  WorkStatus,
  WorkType,
  ExecutionStatus,
  RelationType,
  ActorType,
  AdapterType,
  ActorAvailability,
  AutonomyLevel,
  CanonicalUri,
} from '../src/core';
import { WorkflowStage } from '../src/config';

describe('StageRunnerService (Dynamic Stages & Model-Aware Execution)', () => {
  let dbService: DatabaseService;
  let store: FactoryStoreService;
  let lineage: LineageService;
  let reporter: ReporterService;
  let runner: StageRunnerService;
  let agyMock: MockAgentAdapter;
  let claudeMock: MockAgentAdapter;

  beforeEach(() => {
    dbService = new DatabaseService(':memory:');
    dbService.connect();
    store = new FactoryStoreService(dbService);
    lineage = new LineageService(store);
    reporter = new ReporterService(store, lineage);
    runner = new StageRunnerService(store, lineage, reporter);

    agyMock = new MockAgentAdapter('agy');
    claudeMock = new MockAgentAdapter('claude');
    runner.registerAdapter(agyMock);
    runner.registerAdapter(claudeMock);

    // Seed actors
    store.saveActor({
      id: 'agy',
      name: 'Google Antigravity Agent',
      type: ActorType.INTERNAL_AGENT,
      adapterType: AdapterType.CLI,
      capabilities: ['code_generation', 'implementation'],
      model: 'gemini-3.8-flash',
      availability: ActorAvailability.AVAILABLE,
      autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
      config: { model: 'gemini-3.8-flash' },
      createdAt: new Date().toISOString(),
    });

    store.saveActor({
      id: 'claude',
      name: 'Claude Code Agent',
      type: ActorType.INTERNAL_AGENT,
      adapterType: AdapterType.CLI,
      capabilities: ['planning', 'code_review'],
      model: 'claude-3-7-sonnet',
      availability: ActorAvailability.AVAILABLE,
      autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
      config: { model: 'claude-3-7-sonnet' },
      createdAt: new Date().toISOString(),
    });

    store.saveActor({
      id: 'human:ali',
      name: 'Ali (Human Gate)',
      type: ActorType.HUMAN,
      adapterType: AdapterType.MANUAL,
      capabilities: ['approval'],
      availability: ActorAvailability.AVAILABLE,
      autonomyLevel: AutonomyLevel.HUMAN_ONLY,
      config: {},
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    dbService.close();
  });

  it('should execute dynamic stages in sequence, chaining context and recording relations', async () => {
    const stages: WorkflowStage[] = [
      {
        name: 'plan',
        actor: 'claude',
        description: 'Plan architecture',
        required: true,
        timeoutSeconds: 60,
        config: {},
      },
      {
        name: 'implement',
        actor: 'agy',
        description: 'Implement code and tests',
        required: true,
        timeoutSeconds: 120,
        config: {},
      },
      {
        name: 'review',
        actor: 'claude',
        description: 'Review code quality',
        required: true,
        timeoutSeconds: 60,
        config: {},
      },
    ];

    claudeMock.customLogs = 'Architecture plan completed.';
    agyMock.customLogs = 'Implementation and unit tests created.';

    const result = await runner.runStages(stages, {
      pipelineTitle: 'Add Payment Webhook',
      pipelineDescription: 'Support Stripe webhooks',
      workingDirectory: '/tmp',
      correlationId: 'corr-stage-1',
    });

    expect(result.success).toBe(true);
    expect(result.stagesExecuted.length).toBe(3);
    expect(result.stagesExecuted[0].stageName).toBe('plan');
    expect(result.stagesExecuted[1].stageName).toBe('implement');
    expect(result.stagesExecuted[2].stageName).toBe('review');

    // Verify context chaining in logs
    expect(result.finalOutput).toContain('Architecture plan completed.');
    expect(result.finalOutput).toContain('Implementation and unit tests created.');

    // Verify relations in database
    const planWorkId = result.stagesExecuted[0].workId;
    const implWorkId = result.stagesExecuted[1].workId;
    const reviewWorkId = result.stagesExecuted[2].workId;

    const implRelations = store.getRelationsForSource(CanonicalUri.factoryWork(implWorkId));
    expect(implRelations.some((r) => r.targetRef === CanonicalUri.factoryWork(planWorkId))).toBe(true);

    const reviewRelations = store.getRelationsForSource(CanonicalUri.factoryWork(reviewWorkId));
    expect(reviewRelations.some((r) => r.targetRef === CanonicalUri.factoryWork(implWorkId) && r.relationType === RelationType.VERIFIES)).toBe(true);
  });

  it('should resolve model from actor configuration and pass to adapter', async () => {
    const stages: WorkflowStage[] = [
      {
        name: 'implement',
        actor: 'agy',
        required: true,
        config: {},
      },
    ];

    await runner.runStages(stages, {
      pipelineTitle: 'Model Test',
      pipelineDescription: 'Check model passing',
      workingDirectory: '/tmp',
      correlationId: 'corr-model-1',
    });

    expect(agyMock.lastModel).toBe('gemini-3.8-flash');
    expect(agyMock.lastActor?.id).toBe('agy');
  });

  it('should pause execution when a stage specifies a human approval gate', async () => {
    const stages: WorkflowStage[] = [
      {
        name: 'plan',
        actor: 'claude',
        required: true,
        config: {},
      },
      {
        name: 'approval',
        gate: 'human_approval',
        required: true,
        config: {},
      },
      {
        name: 'implement',
        actor: 'agy',
        required: true,
        config: {},
      },
    ];

    const result = await runner.runStages(stages, {
      pipelineTitle: 'Sensitive Deployment',
      pipelineDescription: 'Database migration',
      workingDirectory: '/tmp',
      correlationId: 'corr-gate-1',
    });

    expect(result.success).toBe(true);
    expect(result.stagesExecuted.length).toBe(2); // plan executed, approval paused, implement not reached
    expect(result.stagesExecuted[1].status).toBe('paused');
    expect(result.stagesExecuted[1].gateEncountered).toBe('human_approval');

    const approvalWork = store.getWork(result.stagesExecuted[1].workId);
    expect(approvalWork?.type).toBe(WorkType.APPROVAL);
    expect(approvalWork?.status).toBe(WorkStatus.PENDING);
  });

  it('should halt pipeline if a required stage fails', async () => {
    const stages: WorkflowStage[] = [
      {
        name: 'implement',
        actor: 'agy',
        required: true,
        config: {},
      },
      {
        name: 'review',
        actor: 'claude',
        required: true,
        config: {},
      },
    ];

    agyMock.shouldFail = true;

    const result = await runner.runStages(stages, {
      pipelineTitle: 'Failing Stage Test',
      pipelineDescription: 'Should stop at implement',
      workingDirectory: '/tmp',
      correlationId: 'corr-fail-1',
    });

    expect(result.success).toBe(false);
    expect(result.stagesExecuted.length).toBe(1);
    expect(result.failedStage?.stageName).toBe('implement');
    expect(result.failedStage?.error).toBe('Mock intentional error');
  });

  it('should continue pipeline if an optional (required: false) stage fails', async () => {
    const stages: WorkflowStage[] = [
      {
        name: 'benchmark',
        actor: 'agy',
        required: false,
        config: {},
      },
      {
        name: 'review',
        actor: 'claude',
        required: true,
        config: {},
      },
    ];

    agyMock.shouldFail = true;

    const result = await runner.runStages(stages, {
      pipelineTitle: 'Optional Stage Test',
      pipelineDescription: 'Should continue past benchmark',
      workingDirectory: '/tmp',
      correlationId: 'corr-opt-1',
    });

    expect(result.success).toBe(true);
    expect(result.stagesExecuted.length).toBe(2);
    expect(result.stagesExecuted[0].status).toBe(ExecutionStatus.FAILED);
    expect(result.stagesExecuted[1].status).toBe(ExecutionStatus.COMPLETED);
  });
});
