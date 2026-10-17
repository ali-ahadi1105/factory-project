import { OpencodeAdapter } from '../src/adapters/opencode.adapter';
import { Work, Execution, ExecutionStatus, WorkType, WorkPriority, WorkStatus } from '../src/core';

describe('OpencodeAdapter', () => {
  let adapter: OpencodeAdapter;

  beforeEach(() => {
    adapter = new OpencodeAdapter();
  });

  it('should have correct identity and capabilities', () => {
    expect(adapter.id).toBe('opencode');
    expect(adapter.name).toBe('OpenCode CLI');
    expect(adapter.capabilities).toContain('implementation');
    expect(adapter.capabilities).toContain('code_generation');
    expect(adapter.capabilities).toContain('refactoring');
  });

  it('should detect if opencode binary is available', async () => {
    const isAvail = await adapter.isAvailable();
    // On this host, opencode is installed at ~/.opencode/bin/opencode
    expect(typeof isAvail).toBe('boolean');
    expect(isAvail).toBe(true);
  });

  it('should fail cleanly when binary path does not exist', async () => {
    const customAdapter = new OpencodeAdapter('/non/existent/path/to/opencode');
    const work: Work = {
      id: 'test-work-1',
      title: 'Test Work',
      description: 'Test Description',
      type: WorkType.IMPLEMENTATION,
      status: WorkStatus.PENDING,
      priority: WorkPriority.MEDIUM,
      context: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const execution: Execution = {
      id: 'test-exec-1',
      workId: 'test-work-1',
      actorId: 'opencode',
      status: ExecutionStatus.RUNNING,
      correlationId: 'test-corr-1',
      causationId: 'factory://work/test-work-1',
      logs: '',
      producedReferences: [],
      startedAt: new Date().toISOString(),
    };

    const res = await customAdapter.execute(work, execution, '/tmp', 5);
    expect(res.status).toBe(ExecutionStatus.FAILED);
    expect(res.error).toContain('not found');
  });
});
