/**
 * Software Factory Concept v31 - Core Enumerations
 *
 * System of Coordination for software development, orchestrating humans, agents, and tools.
 * Factory stores only Reference + Relation + Coordination State.
 */

/**
 * Status of a Work item in the coordination cycle.
 */
export enum WorkStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  BLOCKED = 'blocked',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Priority level of a Work item.
 */
export enum WorkPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Categorization of Work items.
 *
 * Per Concept v31 Section 7: Tests, Reviews, Approvals, Deployments,
 * Investigations, and Planning are not separate subsystems; they are
 * all unified representations of the Work primitive.
 */
export enum WorkType {
  IMPLEMENTATION = 'implementation',
  INVESTIGATION = 'investigation',
  TEST = 'test',
  REVIEW = 'review',
  APPROVAL = 'approval',
  DEPLOY = 'deploy',
  PLANNING = 'planning',
  CUSTOM = 'custom',
}

/**
 * Categorization of Actors.
 *
 * Per Concept v31 Section 4: Humans and Agents share the exact same core model.
 * The differentiation is purely contextual (adapter, owner, capabilities, autonomy).
 */
export enum ActorType {
  HUMAN = 'human',
  INTERNAL_AGENT = 'internal_agent',
  EXTERNAL_AGENT = 'external_agent',
}

/**
 * Current availability and operational health of an Actor.
 */
export enum ActorAvailability {
  AVAILABLE = 'available',
  BUSY = 'busy',
  OFFLINE = 'offline',
  DEGRADED = 'degraded',
  UNKNOWN = 'unknown',
}

/**
 * Execution adapter used to interface with an Actor.
 *
 * Per Concept v31 Section 4: The Factory is protocol-agnostic.
 * Core does not depend on MCP, A2A, HTTP, or CLI specifics.
 */
export enum AdapterType {
  CLI = 'cli',
  MCP = 'mcp',
  A2A = 'a2a',
  HTTP = 'http',
  WEBHOOK = 'webhook',
  MANUAL = 'manual',
  CUSTOM = 'custom',
}

/**
 * Autonomy policy governing an Actor's execution boundaries.
 * Concept v31 Section 9: Configured per factory and work scope.
 */
export enum AutonomyLevel {
  AUTONOMOUS = 'autonomous',
  SEMI_AUTONOMOUS = 'semi_autonomous',
  HUMAN_IN_THE_LOOP = 'human_in_the_loop',
  HUMAN_ONLY = 'human_only',
}

/**
 * Execution run/attempt status.
 */
export enum ExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMED_OUT = 'timed_out',
  CANCELLED = 'cancelled',
}

/**
 * Core Lineage Relation Types.
 *
 * Concept v31 Section 2 & 8: Explicit, cross-system links between entities.
 * - triggered-by: Work or Execution triggered by an Event or Signal
 * - performed-by: Work attempted or carried out by an Actor
 * - produced: Execution or Work produced an artifact/Reference (e.g. MR, commit, report)
 * - depends-on: Work depends on another Work or Reference
 * - verifies: Work/Execution verifies a Reference (e.g. tests or security review verifies an MR)
 * - derived-from: Entity was derived from another entity
 * - caused: Direct causal link (e.g. customer-call caused incident-work)
 */
export enum RelationType {
  TRIGGERED_BY = 'triggered-by',
  PERFORMED_BY = 'performed-by',
  PRODUCED = 'produced',
  DEPENDS_ON = 'depends-on',
  VERIFIES = 'verifies',
  DERIVED_FROM = 'derived-from',
  CAUSED = 'caused',
}

/**
 * Known Reference URI Schemes.
 *
 * Concept v31 Section 2 & Examples: Persistent pointers to internal and external entities.
 * External data stays in external systems of record.
 */
export enum ReferenceScheme {
  FACTORY = 'factory',
  GITHUB = 'github',
  GITLAB = 'gitlab',
  JIRA = 'jira',
  LINEAR = 'linear',
  SLACK = 'slack',
  TELEGRAM = 'telegram',
  AGENT = 'agent',
  CI = 'ci',
  GIT = 'git',
  FILE = 'file',
  HTTP = 'http',
  HTTPS = 'https',
  CUSTOM = 'custom',
}

/**
 * Ingestion and processing status of external Signals.
 *
 * Concept v31 Section 6: Signals are raw external triggers (webhook, email, alert)
 * that intake policies may translate into Work.
 */
export enum SignalStatus {
  RECEIVED = 'received',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  IGNORED = 'ignored',
  FAILED = 'failed',
}

/**
 * Log severity levels for Execution records.
 */
export enum ExecutionLogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Core lifecycle event types for coordination event streaming.
 */
export enum FactoryEventType {
  // Work events
  WORK_CREATED = 'work.created',
  WORK_UPDATED = 'work.updated',
  WORK_ASSIGNED = 'work.assigned',
  WORK_STATUS_CHANGED = 'work.status_changed',
  WORK_COMPLETED = 'work.completed',
  WORK_FAILED = 'work.failed',
  WORK_CANCELLED = 'work.cancelled',

  // Execution events
  EXECUTION_STARTED = 'execution.started',
  EXECUTION_UPDATED = 'execution.updated',
  EXECUTION_COMPLETED = 'execution.completed',
  EXECUTION_FAILED = 'execution.failed',
  EXECUTION_RETRY = 'execution.retry',
  EXECUTION_TIMED_OUT = 'execution.timed_out',

  // Actor events
  ACTOR_REGISTERED = 'actor.registered',
  ACTOR_STATUS_CHANGED = 'actor.status_changed',
  ACTOR_UPDATED = 'actor.updated',

  // Signal events
  SIGNAL_RECEIVED = 'signal.received',
  SIGNAL_PROCESSED = 'signal.processed',
  SIGNAL_IGNORED = 'signal.ignored',
  SIGNAL_FAILED = 'signal.failed',

  // Lineage events
  RELATION_CREATED = 'relation.created',
  REFERENCE_CREATED = 'reference.created',
}
