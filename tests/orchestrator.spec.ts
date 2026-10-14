import { DatabaseService, FactoryStoreService } from '../src/store';
import { LineageService, OrchestratorService, ReporterService } from '../src/engine';
import { MockAgentAdapter, GitHubAdapter, TelegramAdapter, GitHubIssue, GitHubPr } from '../src/adapters';
import { WorkStatus, ExecutionStatus, CanonicalUri } from '../src/core';

describe('Factory Orchestrator Service', () => {
  let dbService: DatabaseService;
  let store: FactoryStoreService;
  let lineage: LineageService;
  let reporter: ReporterService;
  let orchestrator: OrchestratorService;
  let mockAdapter: MockAgentAdapter;
  let agyMock: MockAgentAdapter;
  let claudeMock: MockAgentAdapter;
  let githubAdapter: GitHubAdapter;
  let telegramAdapter: TelegramAdapter;

  beforeEach(() => {
    dbService = new DatabaseService(':memory:');
    dbService.connect();
    store = new FactoryStoreService(dbService);
    lineage = new LineageService(store);
    reporter = new ReporterService(store, lineage);
    agyMock = new MockAgentAdapter('agy');
    claudeMock = new MockAgentAdapter('claude');
    mockAdapter = new MockAgentAdapter('mock-agent');
    githubAdapter = new GitHubAdapter();
    telegramAdapter = new TelegramAdapter();

    const mockIssue: GitHubIssue = {
      number: 99,
      title: 'Mock Issue',
      body: 'Body',
      url: 'https://github.com/fake/issue/99',
      state: 'open',
    };

    const mockPr: GitHubPr = {
      number: 101,
      title: 'Mock PR',
      url: 'https://github.com/fake/pull/101',
      state: 'open',
      headRefName: 'feature/mock',
      baseRefName: 'main',
    };

    // Prevent unit tests from executing external git/gh commands
    jest.spyOn(githubAdapter, 'detectRepo').mockResolvedValue(null);
    jest.spyOn(githubAdapter, 'createIssue').mockResolvedValue(mockIssue);
    jest.spyOn(githubAdapter, 'createBranch').mockResolvedValue();
    jest.spyOn(githubAdapter, 'commitAll').mockResolvedValue('commit-sha');
    jest.spyOn(githubAdapter, 'pushBranch').mockResolvedValue();
    jest.spyOn(githubAdapter, 'createPullRequest').mockResolvedValue(mockPr);
    jest.spyOn(githubAdapter, 'addIssueComment').mockResolvedValue();

    orchestrator = new OrchestratorService(
      store,
      lineage,
      agyMock as any,
      claudeMock as any,
      githubAdapter,
      telegramAdapter,
      reporter,
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
    jest.restoreAllMocks();
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

  it('should update live Telegram progress and broadcast events during runPipeline', async () => {
    // Mock telegram fetch
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ ok: true, result: { message_id: 999 } }),
    } as any);

    // Mock reporter broadcast
    const broadcastSpy = jest.spyOn(reporter, 'broadcastProgress');
    const logSpy = jest.spyOn(reporter, 'broadcastLog');

    const result = await orchestrator.runPipeline({
      title: 'Realtime Pipeline Feature',
      description: 'Test live notifications',
      workingDirectory: process.cwd(),
      skipTests: true,
      telegramNotification: {
        botToken: 'dummy-bot-token',
        chatId: 12345,
      },
    });

    expect(result.workId).toBeDefined();
    expect(broadcastSpy).toHaveBeenCalledWith('implement', 'in_progress', expect.any(String));
    expect(broadcastSpy).toHaveBeenCalledWith('implement', 'completed', expect.any(String));
    expect(broadcastSpy).toHaveBeenCalledWith('review', 'in_progress', expect.any(String));
    expect(broadcastSpy).toHaveBeenCalledWith('review', 'completed', expect.any(String));
    expect(logSpy).toHaveBeenCalled();
  });
});
