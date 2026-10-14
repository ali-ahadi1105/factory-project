import { DatabaseService, FactoryStoreService } from '../src/store';
import { LineageService, OrchestratorService, ReporterService } from '../src/engine';
import { MockAgentAdapter, GitHubAdapter, TelegramAdapter, GitHubIssue, GitHubPr } from '../src/adapters';
import { WorkStatus, ExecutionStatus, WorkType, WorkPriority, RelationType } from '../src/core';

describe('Failure Rollback and Auto-Triage', () => {
  let dbService: DatabaseService;
  let store: FactoryStoreService;
  let lineage: LineageService;
  let reporter: ReporterService;
  let orchestrator: OrchestratorService;
  let agyMock: MockAgentAdapter;
  let claudeMock: MockAgentAdapter;
  let githubAdapter: GitHubAdapter;
  let telegramAdapter: TelegramAdapter;

  const mockIssue: GitHubIssue = {
    number: 42,
    title: 'Failure Rollback Issue',
    body: 'Task description',
    url: 'https://github.com/ali-ahadi1105/factory-project/issues/42',
    state: 'open',
  };

  const mockPr: GitHubPr = {
    number: 105,
    title: 'Mock PR',
    url: 'https://github.com/ali-ahadi1105/factory-project/pull/105',
    state: 'open',
    headRefName: 'feature/mock',
    baseRefName: 'main',
  };

  beforeEach(() => {
    dbService = new DatabaseService(':memory:');
    dbService.connect();
    store = new FactoryStoreService(dbService);
    lineage = new LineageService(store);
    reporter = new ReporterService(store, lineage);
    agyMock = new MockAgentAdapter('agy');
    claudeMock = new MockAgentAdapter('claude');
    githubAdapter = new GitHubAdapter();
    telegramAdapter = new TelegramAdapter();

    jest.spyOn(githubAdapter, 'detectRepo').mockResolvedValue('ali-ahadi1105/factory-project');
    jest.spyOn(githubAdapter, 'createIssue').mockResolvedValue(mockIssue);
    jest.spyOn(githubAdapter, 'createBranch').mockResolvedValue();
    jest.spyOn(githubAdapter, 'commitAll').mockResolvedValue('commit-sha-123');
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
  });

  afterEach(() => {
    dbService.close();
    jest.restoreAllMocks();
  });

  describe('Automated Test Failure Rollback', () => {
    it('should halt pipeline, mark work as FAILED in factory.db, post issue comment, and NOT create PR', async () => {
      const commentSpy = jest.spyOn(githubAdapter, 'addIssueComment');
      const prSpy = jest.spyOn(githubAdapter, 'createPullRequest');

      const result = await orchestrator.runPipeline({
        title: 'Feature with failing test',
        description: 'Testing rollback mechanism',
        workingDirectory: process.cwd(),
        issueNumber: 42,
        githubRepo: 'ali-ahadi1105/factory-project',
        testCommand: 'node -e "console.error(\\"SyntaxError: Unexpected token in math.ts:12\\"); process.exit(1);"',
      });

      // 1. Pipeline result checks
      expect(result.testPassed).toBe(false);
      expect(result.prUrl).toBeUndefined();
      expect(result.prNumber).toBeUndefined();
      expect(result.error).toContain('Automated tests failed');
      expect(result.error).toContain('SyntaxError: Unexpected token');

      // 2. PR creation was NOT attempted (verified gate passed)
      expect(prSpy).not.toHaveBeenCalled();

      // 3. Work in factory.db is updated to FAILED with exact error cause
      const savedWork = store.getWork(result.workId);
      expect(savedWork).not.toBeNull();
      expect(savedWork?.status).toBe(WorkStatus.FAILED);
      expect(savedWork?.context.failedStep).toBe('test');
      expect(savedWork?.context.error).toContain('Automated tests failed');
      expect(savedWork?.context.testOutput).toContain('SyntaxError: Unexpected token');

      // 4. GitHub Issue received failure comment
      expect(commentSpy).toHaveBeenCalledTimes(1);
      const [repo, issueNum, commentBody] = commentSpy.mock.calls[0];
      expect(repo).toBe('ali-ahadi1105/factory-project');
      expect(issueNum).toBe(42);
      expect(commentBody).toContain('❌ Software Factory Pipeline Failure Report');
      expect(commentBody).toContain('Failed Step:** Automated Tests');
      expect(commentBody).toContain('SyntaxError: Unexpected token');
      expect(commentBody).toContain('factory triage');
    });
  });

  describe('Implementation Failure Rollback', () => {
    it('should halt pipeline when implementation fails, mark work as FAILED, and post issue comment', async () => {
      // Simulate implementation failure on claude
      claudeMock.shouldFail = true;
      const commentSpy = jest.spyOn(githubAdapter, 'addIssueComment');
      const prSpy = jest.spyOn(githubAdapter, 'createPullRequest');

      const result = await orchestrator.runPipeline({
        title: 'Failing implementation feature',
        description: 'Verify implement step failure rollback',
        workingDirectory: process.cwd(),
        issueNumber: 42,
        githubRepo: 'ali-ahadi1105/factory-project',
        implementer: 'claude',
        skipTests: true,
      });

      expect(result.prUrl).toBeUndefined();
      expect(prSpy).not.toHaveBeenCalled();

      const savedWork = store.getWork(result.workId);
      expect(savedWork?.status).toBe(WorkStatus.FAILED);
      expect(savedWork?.context.failedStep).toBe('implement');
      expect(savedWork?.context.error).toContain('Mock intentional error');

      expect(commentSpy).toHaveBeenCalledTimes(1);
      expect(commentSpy.mock.calls[0][1]).toBe(42);
      expect(commentSpy.mock.calls[0][2]).toContain('Failed Step:** Implementation');
    });
  });

  describe('Review Failure Rollback', () => {
    it('should halt pipeline when review fails, mark work as FAILED, and post issue comment', async () => {
      // agy succeeds for implementation, claude fails for review
      agyMock.shouldFail = false;
      claudeMock.shouldFail = true;

      const commentSpy = jest.spyOn(githubAdapter, 'addIssueComment');
      const prSpy = jest.spyOn(githubAdapter, 'createPullRequest');

      const result = await orchestrator.runPipeline({
        title: 'Failing review feature',
        description: 'Verify review step failure rollback',
        workingDirectory: process.cwd(),
        issueNumber: 42,
        githubRepo: 'ali-ahadi1105/factory-project',
        implementer: 'agy',
        skipTests: true,
      });

      expect(result.prUrl).toBeUndefined();
      expect(prSpy).not.toHaveBeenCalled();

      const savedWork = store.getWork(result.workId);
      expect(savedWork?.status).toBe(WorkStatus.FAILED);
      expect(savedWork?.context.failedStep).toBe('review');
      expect(savedWork?.context.error).toContain('Review failed');

      expect(commentSpy).toHaveBeenCalledTimes(1);
      expect(commentSpy.mock.calls[0][2]).toContain('Failed Step:** Review & Verification');
    });
  });

  describe('Triage Command and Inspection', () => {
    it('should accurately triage failed work with root causes, executions, relations, and lineage', () => {
      const now = new Date().toISOString();
      const workId = 'failed-work-999';

      store.saveWork({
        id: workId,
        title: 'Broken Payment Gateway',
        description: 'Fix stripe webhook',
        type: WorkType.IMPLEMENTATION,
        status: WorkStatus.FAILED,
        priority: WorkPriority.HIGH,
        context: {
          failedStep: 'test',
          error: 'Automated tests failed:\nAssertionError: expected 200 to equal 400',
          testOutput: 'AssertionError: expected 200 to equal 400',
        },
        createdAt: now,
        updatedAt: now,
      });

      store.saveExecution({
        id: 'exec-fail-1',
        workId,
        actorId: 'claude',
        status: ExecutionStatus.FAILED,
        correlationId: 'corr-1',
        causationId: `factory://work/${workId}`,
        logs: 'Test run output: 1 failed, 0 passed',
        error: 'Test suite failed',
        producedReferences: [],
        startedAt: now,
        finishedAt: now,
      });

      store.saveRelation({
        id: 'rel-1',
        sourceRef: `factory://work/${workId}`,
        targetRef: 'github://issue/ali-ahadi1105/factory-project/42',
        relationType: RelationType.TRIGGERED_BY,
        metadata: {},
        createdAt: now,
      });

      const triage = orchestrator.triage(workId);

      expect(triage.workId).toBe(workId);
      expect(triage.title).toBe('Broken Payment Gateway');
      expect(triage.status).toBe(WorkStatus.FAILED);
      expect(triage.failed).toBe(true);
      expect(triage.failedStep).toBe('test');
      expect(triage.rootCause).toContain('AssertionError: expected 200 to equal 400');
      expect(triage.executions.length).toBe(1);
      expect(triage.executions[0].actorId).toBe('claude');
      expect(triage.executions[0].status).toBe(ExecutionStatus.FAILED);
      expect(triage.relations.length).toBe(1);
      expect(triage.lineageTree).toContain(`Root: factory://work/${workId}`);
      expect(triage.recommendations).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Automated tests failed'),
          expect.stringContaining('Rollback verified'),
        ]),
      );

      // Verify formatted output
      const formatted = orchestrator.formatTriageReport(triage);
      expect(formatted).toContain('🔍 Factory Triage Report: failed-work-999');
      expect(formatted).toContain('Status:      ❌ FAILED');
      expect(formatted).toContain('Failed Step: test');
      expect(formatted).toContain('Root Cause / Error:');
      expect(formatted).toContain('AssertionError: expected 200 to equal 400');
      expect(formatted).toContain('Execution Attempts (1):');
      expect(formatted).toContain('Recommendations:');
    });

    it('should throw when triaging a non-existent work item', () => {
      expect(() => orchestrator.triage('non-existent-work-id')).toThrow(
        'Work with ID non-existent-work-id not found',
      );
    });

    it('should provide appropriate triage report for completed work', () => {
      const now = new Date().toISOString();
      const workId = 'success-work-100';

      store.saveWork({
        id: workId,
        title: 'Working Auth System',
        description: 'Authentication',
        type: WorkType.IMPLEMENTATION,
        status: WorkStatus.COMPLETED,
        priority: WorkPriority.MEDIUM,
        context: {},
        createdAt: now,
        updatedAt: now,
      });

      const triage = orchestrator.triage(workId);
      expect(triage.failed).toBe(false);
      expect(triage.status).toBe(WorkStatus.COMPLETED);
      expect(triage.recommendations[0]).toContain('No failure triage required');

      const formatted = orchestrator.formatTriageReport(triage);
      expect(formatted).toContain('Status:      ✅ COMPLETED');
    });
  });
});
