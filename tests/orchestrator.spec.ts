import { DatabaseService, FactoryStoreService } from '../src/store';
import { LineageService, OrchestratorService } from '../src/engine';
import { MockAgentAdapter, GitHubAdapter } from '../src/adapters';
import { WorkStatus, ExecutionStatus, CanonicalUri } from '../src/core';

describe('Factory Orchestrator Service', () => {
  let dbService: DatabaseService;
  let store: FactoryStoreService;
  let lineage: LineageService;
  let orchestrator: OrchestratorService;
  let mockAdapter: MockAgentAdapter;
  let githubAdapter: GitHubAdapter;

  beforeEach(() => {
    dbService = new DatabaseService(':memory:');
    dbService.connect();
    store = new FactoryStoreService(dbService);
    lineage = new LineageService(store);
    mockAdapter = new MockAgentAdapter();
    githubAdapter = new GitHubAdapter();

    orchestrator = new OrchestratorService(
      store,
      lineage,
      mockAdapter as any, // agy mock
      mockAdapter as any, // claude mock
      githubAdapter,
    );
    orchestrator.registerAdapter(mockAdapter);

    store.saveActor({
      id: 'mock-agent',
      name: 'Mock Testing Agent',
      type: 'internal_agent' as any,
      adapterType: 'cli' as any,
      capabilities: ['code_generation'],
      availability: 'available' as any,
      autonomyLevel: 'autonomous' as any,
      config: {},
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    dbService.close();
  });

  it('should ingest signal, create work, and record lineage', async () => {
    const { signal, work } = await orchestrator.ingestSignal(
      'telegram',
      'user_message',
      { title: 'Add auth middleware', description: 'Validate JWT' },
      'unique-key-1',
    );

    expect(signal).toBeDefined();
    expect(work).toBeDefined();
    expect(work?.title).toBe('Add auth middleware');
    expect(work?.status).toBe(WorkStatus.PENDING);

    // Verify duplicate signal does not create duplicate work
    const duplicate = await orchestrator.ingestSignal(
      'telegram',
      'user_message',
      { title: 'Add auth middleware', description: 'Validate JWT' },
      'unique-key-1',
    );
    expect(duplicate.work).toBeUndefined();
    expect(duplicate.signal.id).toBe(signal.id);
  });

  it('should execute work with an actor adapter and record execution', async () => {
    const { work } = await orchestrator.ingestSignal(
      'cli',
      'manual_task',
      { title: 'Write tests', description: 'Unit tests for store' },
    );

    const result = await orchestrator.executeWork(work!.id, 'mock-agent', process.cwd());
    expect(result.status).toBe(ExecutionStatus.COMPLETED);

    const updatedWork = store.getWork(work!.id);
    expect(updatedWork?.status).toBe(WorkStatus.COMPLETED);

    const executions = store.listExecutionsForWork(work!.id);
    expect(executions.length).toBe(1);
    expect(executions[0].actorId).toBe('mock-agent');
    expect(executions[0].status).toBe(ExecutionStatus.COMPLETED);
  });

  it('should format ASCII lineage tree correctly', async () => {
    const { work } = await orchestrator.ingestSignal(
      'github',
      'issue_opened',
      { title: 'Fix memory leak', description: 'Issue #10' },
    );

    await orchestrator.executeWork(work!.id, 'mock-agent', process.cwd());

    const tree = lineage.formatAsciiTree(CanonicalUri.factoryWork(work!.id));
    expect(tree).toContain('Root: factory://work/');
    expect(tree).toContain('triggered-by');
    expect(tree).toContain('performed-by');
    expect(tree).toContain('produced');
  });
});
