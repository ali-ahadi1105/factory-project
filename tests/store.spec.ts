import { DatabaseService, FactoryStoreService } from '../src/store';
import {
  Work,
  Actor,
  Execution,
  Reference,
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
} from '../src/core';

describe('Factory SQLite Store', () => {
  let dbService: DatabaseService;
  let store: FactoryStoreService;

  beforeEach(() => {
    dbService = new DatabaseService(':memory:');
    dbService.connect();
    store = new FactoryStoreService(dbService);
  });

  afterEach(() => {
    dbService.close();
  });

  it('should save and retrieve a Work item', () => {
    const work: Work = {
      id: 'w-1',
      title: 'Setup Gateway',
      description: 'Configure 9Router',
      type: WorkType.IMPLEMENTATION,
      status: WorkStatus.PENDING,
      priority: WorkPriority.HIGH,
      context: { foo: 'bar' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.saveWork(work);
    const retrieved = store.getWork('w-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('w-1');
    expect(retrieved?.title).toBe('Setup Gateway');
    expect(retrieved?.context.foo).toBe('bar');
  });

  it('should save and list Actors', () => {
    const actor: Actor = {
      id: 'agy',
      name: 'Google Antigravity',
      type: ActorType.INTERNAL_AGENT,
      adapterType: AdapterType.CLI,
      capabilities: ['code_generation'],
      availability: ActorAvailability.AVAILABLE,
      autonomyLevel: AutonomyLevel.AUTONOMOUS,
      config: {},
      createdAt: new Date().toISOString(),
    };

    store.saveActor(actor);
    const list = store.listActors();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('agy');
  });

  it('should handle signals and enforce idempotency', () => {
    const sig: Signal = {
      id: 's-1',
      source: 'telegram',
      signalType: 'user_message',
      payload: { text: 'deploy v1' },
      idempotencyKey: 'idem-100',
      correlationId: 'corr-100',
      status: SignalStatus.RECEIVED,
      occurredAt: new Date().toISOString(),
    };

    store.saveSignal(sig);
    const retrieved = store.getSignalByIdempotencyKey('idem-100');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.payload.text).toBe('deploy v1');

    // Updating status idempotently
    sig.status = SignalStatus.PROCESSED;
    store.saveSignal(sig);
    const updated = store.getSignalByIdempotencyKey('idem-100');
    expect(updated?.status).toBe(SignalStatus.PROCESSED);
  });

  it('should store relations and build lineage graph', () => {
    // Save relations: sig -> work -> exec -> ref
    const rel1: Relation = {
      id: 'r-1',
      sourceRef: 'factory://work/w-1',
      targetRef: 'signal://telegram/s-1',
      relationType: RelationType.TRIGGERED_BY,
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    const rel2: Relation = {
      id: 'r-2',
      sourceRef: 'agent://agy/run/e-1',
      targetRef: 'factory://work/w-1',
      relationType: RelationType.PERFORMED_BY,
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    const rel3: Relation = {
      id: 'r-3',
      sourceRef: 'agent://agy/run/e-1',
      targetRef: 'git://commit/c-123',
      relationType: RelationType.PRODUCED,
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    store.saveRelation(rel1);
    store.saveRelation(rel2);
    store.saveRelation(rel3);

    const graph = store.getLineageGraph('factory://work/w-1');
    expect(graph.nodes.length).toBeGreaterThanOrEqual(3);
    expect(graph.edges.length).toBe(3);
  });
});
