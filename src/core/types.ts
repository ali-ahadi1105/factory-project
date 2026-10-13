import {
  WorkStatus,
  WorkPriority,
  WorkType,
  ActorType,
  ActorAvailability,
  AdapterType,
  AutonomyLevel,
  ExecutionStatus,
  RelationType,
  ReferenceScheme,
  SignalStatus,
  FactoryEventType,
} from './enums';

/**
 * Work Primitive: Unit of task to be tracked and coordinated.
 */
export interface Work {
  id: string;
  title: string;
  description: string;
  type: WorkType;
  status: WorkStatus;
  priority: WorkPriority;
  assignedActorId?: string;
  context: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Actor Primitive: Performer of Work (Human or Agent share the exact same model).
 */
export interface Actor {
  id: string;
  name: string;
  type: ActorType;
  adapterType: AdapterType;
  capabilities: string[];
  availability: ActorAvailability;
  autonomyLevel: AutonomyLevel;
  owner?: string;
  config: Record<string, any>;
  createdAt: string;
}

/**
 * Execution Primitive: A single attempt or run to complete a Work item.
 */
export interface Execution {
  id: string;
  workId: string;
  actorId: string;
  status: ExecutionStatus;
  correlationId: string;
  causationId: string;
  logs: string;
  error?: string;
  producedReferences: string[]; // List of reference URIs
  startedAt: string;
  finishedAt?: string;
}

/**
 * Reference Primitive: Persistent pointer to an entity inside or outside Factory.
 */
export interface Reference {
  id: string;
  uri: string;
  scheme: ReferenceScheme | string;
  targetType: string; // e.g. issue, pr, commit, file, run
  metadata: Record<string, any>;
  createdAt: string;
}

/**
 * Relation Primitive: Directed edge representing lineage and causality.
 */
export interface Relation {
  id: string;
  sourceRef: string; // Source URI or Entity ID
  targetRef: string; // Target URI or Entity ID
  relationType: RelationType;
  metadata: Record<string, any>;
  createdAt: string;
}

/**
 * Signal Primitive: External trigger before it becomes Work.
 */
export interface Signal {
  id: string;
  source: string; // github, telegram, alert, etc.
  signalType: string;
  payload: Record<string, any>;
  sourceRef?: string;
  idempotencyKey: string;
  correlationId: string;
  causationId?: string;
  status: SignalStatus;
  occurredAt: string;
  processedAt?: string;
}

/**
 * Event Primitive: Internal event notification for pub/sub decoupling.
 */
export interface FactoryEvent {
  id: string;
  type: FactoryEventType;
  payload: Record<string, any>;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
}

/**
 * Lineage Graph representation.
 */
export interface LineageNode {
  ref: string;
  type: string;
  label: string;
  metadata?: Record<string, any>;
}

export interface LineageEdge {
  from: string;
  to: string;
  relationType: RelationType;
  metadata?: Record<string, any>;
}

export interface LineageGraph {
  rootRef: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
}
