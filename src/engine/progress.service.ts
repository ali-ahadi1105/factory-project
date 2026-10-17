import { Injectable, Logger } from '@nestjs/common';
import { ReporterService } from './reporter.service';

/**
 * Lifecycle status of a single pipeline step as tracked by the progress engine.
 */
export type ProgressStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * Overall lifecycle status of a tracked pipeline run.
 */
export type PipelineProgressStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Static definition of a pipeline step (the checklist the sinks render).
 */
export interface ProgressStepDefinition {
  key: string;
  label: string;
}

/**
 * Mutable state of a single pipeline step.
 */
export interface ProgressStepState extends ProgressStepDefinition {
  status: ProgressStepStatus;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * Complete, protocol-agnostic snapshot of a tracked pipeline run. A copy of this
 * object is handed to every registered {@link ProgressSink} on each event so that
 * channels can render a fully consistent picture (progress bar + checklist).
 */
export interface PipelineProgressState {
  workId: string;
  title: string;
  leadAgent: string;
  liveUrl?: string;
  status: PipelineProgressStatus;
  percent: number;
  steps: ProgressStepState[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
  failedStep?: string;
  prUrl?: string;
  issueUrl?: string;
  branchName?: string;
  testPassed?: boolean;
}

export interface PipelineStartEvent {
  workId: string;
  title: string;
  leadAgent: string;
  liveUrl?: string;
  steps?: ProgressStepDefinition[];
  startedAt?: string;
}

export interface StepStartEvent {
  workId: string;
  stepKey: string;
  label?: string;
  detail?: string;
}

export interface StepProgressEvent {
  workId: string;
  stepKey: string;
  percent?: number;
  detail?: string;
  message?: string;
}

export interface StepCompleteEvent {
  workId: string;
  stepKey: string;
  detail?: string;
  status?: Extract<ProgressStepStatus, 'completed' | 'failed' | 'skipped'>;
  percent?: number;
}

export interface PipelineCompleteEvent {
  workId: string;
  prUrl?: string;
  issueUrl?: string;
  branchName?: string;
  testPassed?: boolean;
  detail?: string;
}

export interface PipelineFailureEvent {
  workId: string;
  error: string;
  stepKey?: string;
}

/**
 * Protocol-agnostic progress sink contract. Any channel (Telegram, Slack, Web,
 * email, ...) can subscribe to pipeline lifecycle events by implementing the
 * subset of callbacks it cares about. Every callback receives the event payload
 * plus the full current {@link PipelineProgressState}.
 *
 * Callbacks are awaited sequentially by the dispatcher and are never allowed to
 * break the pipeline: a throwing/rejecting sink is logged and skipped.
 */
export interface ProgressSink {
  /** Stable unique identifier used for registration / de-registration. */
  readonly id: string;
  onPipelineStart?(event: PipelineStartEvent, state: PipelineProgressState): void | Promise<void>;
  onStepStart?(event: StepStartEvent, state: PipelineProgressState): void | Promise<void>;
  onStepProgress?(event: StepProgressEvent, state: PipelineProgressState): void | Promise<void>;
  onStepComplete?(event: StepCompleteEvent, state: PipelineProgressState): void | Promise<void>;
  onPipelineComplete?(
    event: PipelineCompleteEvent,
    state: PipelineProgressState,
  ): void | Promise<void>;
  onPipelineFailure?(
    event: PipelineFailureEvent,
    state: PipelineProgressState,
  ): void | Promise<void>;
}

/**
 * Default canonical pipeline checklist shared by the orchestrator and all sinks.
 */
export const DEFAULT_PIPELINE_STEPS: ProgressStepDefinition[] = [
  { key: 'issue', label: 'ثبت Issue در گیت‌هاب' },
  { key: 'branch', label: 'ساخت برنچ ایزوله' },
  { key: 'implement', label: 'پیاده‌سازی کد' },
  { key: 'review', label: 'بازبینی و ممیزی کد' },
  { key: 'test', label: 'اجرای تست‌های خودکار' },
  { key: 'pr', label: 'ساخت Pull Request' },
];

/**
 * Render a fixed-width textual progress bar.
 *
 * Examples:
 *   formatProgressBar(50, 20)  -> '██████████░░░░░░░░░░'
 *   formatProgressBar(0, 4)    -> '░░░░'
 *   formatProgressBar(100, 4)  -> '████'
 *
 * @param percent Percentage in the [0, 100] range (clamped, NaN treated as 0).
 * @param totalBlocks Number of blocks the bar is made of (defaults to 20).
 */
export function formatProgressBar(percent: number, totalBlocks = 20): string {
  const blocks = Math.max(1, Math.floor(totalBlocks));
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * blocks);
  return '█'.repeat(filled) + '░'.repeat(blocks - filled);
}

/**
 * Event-driven, multi-channel progress dispatcher.
 *
 * The dispatcher is the single source of truth for pipeline progress: it keeps
 * an in-memory snapshot per work item, mirrors every event to the
 * {@link ReporterService} (SSE / live dashboard) and fans the event out to all
 * registered {@link ProgressSink} implementations.
 *
 * Design guarantees:
 *  - Dispatching never throws; a broken channel degrades gracefully.
 *  - Sinks are invoked sequentially so ordering is deterministic per run.
 *  - The dispatcher is protocol-agnostic and knows nothing about Telegram/web.
 */
@Injectable()
export class ProgressDispatcherService {
  private readonly logger = new Logger(ProgressDispatcherService.name);
  private readonly sinks = new Map<string, ProgressSink>();
  private readonly pipelines = new Map<string, PipelineProgressState>();

  constructor(private readonly reporterService?: ReporterService) {}

  // --- SINK REGISTRY ---

  /** Register (or replace) a channel sink. Returns the dispatcher for chaining. */
  registerSink(sink: ProgressSink): this {
    if (!sink || !sink.id) {
      throw new Error('ProgressSink must expose a non-empty "id".');
    }
    this.sinks.set(sink.id, sink);
    return this;
  }

  /** Remove a previously registered sink. Returns true when it existed. */
  unregisterSink(id: string): boolean {
    return this.sinks.delete(id);
  }

  getSink(id: string): ProgressSink | undefined {
    return this.sinks.get(id);
  }

  listSinks(): ProgressSink[] {
    return Array.from(this.sinks.values());
  }

  clearSinks(): void {
    this.sinks.clear();
  }

  // --- STATE ---

  getPipelineState(workId: string): PipelineProgressState | undefined {
    const state = this.pipelines.get(workId);
    return state ? (JSON.parse(JSON.stringify(state)) as PipelineProgressState) : undefined;
  }

  listPipelines(): PipelineProgressState[] {
    return Array.from(this.pipelines.values()).map(
      (state) => JSON.parse(JSON.stringify(state)) as PipelineProgressState,
    );
  }

  // --- LIFECYCLE DISPATCH ---

  /** Announce the start of a pipeline run (this is what drives the immediate ack). */
  async dispatchPipelineStart(event: PipelineStartEvent): Promise<PipelineProgressState> {
    const definitions = event.steps?.length ? event.steps : DEFAULT_PIPELINE_STEPS;
    const state: PipelineProgressState = {
      workId: event.workId,
      title: event.title,
      leadAgent: event.leadAgent,
      liveUrl: event.liveUrl,
      status: 'in_progress',
      percent: 0,
      steps: definitions.map((step) => ({ key: step.key, label: step.label, status: 'pending' })),
      startedAt: event.startedAt || new Date().toISOString(),
    };

    this.pipelines.set(state.workId, state);
    this.reportProgress('pipeline', 'in_progress', state.title, state);
    this.reportLog(
      'Pipeline',
      `▶️ Pipeline started: ${state.title} (work ${state.workId})`,
      'info',
      state.workId,
    );

    await this.fanOut('onPipelineStart', event, state);
    this.publish(state);
    return state;
  }

  /** Announce that a single step has begun. */
  async dispatchStepStart(event: StepStartEvent): Promise<PipelineProgressState> {
    const state = this.ensureState(event.workId);
    const step = this.ensureStep(state, event.stepKey, event.label);
    step.status = 'in_progress';
    if (event.detail) step.detail = event.detail;
    if (!step.startedAt) step.startedAt = new Date().toISOString();
    this.recalc(state);

    this.reportProgress(event.stepKey, 'in_progress', event.detail ?? step.label, state);
    this.reportLog(
      'Pipeline',
      `Starting ${event.stepKey}...${event.detail ? ` (${event.detail})` : ''}`,
      'info',
      state.workId,
    );

    await this.fanOut('onStepStart', event, state);
    this.publish(state);
    return state;
  }

  /** Report intra-step progress (e.g. a long agent run advancing a bar). */
  async dispatchStepProgress(event: StepProgressEvent): Promise<PipelineProgressState> {
    const state = this.ensureState(event.workId);
    const step = this.ensureStep(state, event.stepKey);
    if (event.detail) step.detail = event.detail;
    if (typeof event.percent === 'number') {
      state.percent = clampPercent(event.percent);
    } else {
      this.recalc(state);
    }

    if (event.message) {
      this.reportLog('Pipeline', event.message, 'info', state.workId);
    }

    await this.fanOut('onStepProgress', event, state);
    this.publish(state);
    return state;
  }

  /** Mark a single step as completed, failed or skipped. */
  async dispatchStepComplete(event: StepCompleteEvent): Promise<PipelineProgressState> {
    const state = this.ensureState(event.workId);
    const step = this.ensureStep(state, event.stepKey);
    step.status = event.status || 'completed';
    if (event.detail) step.detail = event.detail;
    step.finishedAt = new Date().toISOString();
    this.recalc(state);
    if (typeof event.percent === 'number') {
      state.percent = clampPercent(event.percent);
    }

    const reporterStatus = step.status === 'failed' ? 'failed' : 'completed';
    this.reportProgress(event.stepKey, reporterStatus, event.detail ?? step.label, state);
    this.reportLog(
      'Pipeline',
      `${step.status === 'failed' ? 'Failed' : 'Completed'} ${event.stepKey}.${
        event.detail ? ` (${event.detail})` : ''
      }`,
      step.status === 'failed' ? 'error' : 'info',
      state.workId,
    );

    await this.fanOut('onStepComplete', event, state);
    this.publish(state);
    return state;
  }

  /** Announce the successful completion of a pipeline run. */
  async dispatchPipelineComplete(event: PipelineCompleteEvent): Promise<PipelineProgressState> {
    const state = this.ensureState(event.workId);
    state.status = 'completed';
    state.percent = 100;
    state.finishedAt = new Date().toISOString();
    state.prUrl = event.prUrl ?? state.prUrl;
    state.issueUrl = event.issueUrl ?? state.issueUrl;
    state.branchName = event.branchName ?? state.branchName;
    if (typeof event.testPassed === 'boolean') state.testPassed = event.testPassed;
    for (const step of state.steps) {
      if (step.status === 'pending' || step.status === 'in_progress') {
        step.status = 'completed';
        step.finishedAt = step.finishedAt || state.finishedAt;
      }
    }

    const detail = event.detail || event.prUrl;
    this.reportProgress('pipeline', 'completed', detail, state);
    this.reportLog(
      'Pipeline',
      `✅ Pipeline completed for work ${state.workId}${event.prUrl ? ` — ${event.prUrl}` : ''}`,
      'info',
      state.workId,
    );

    await this.fanOut('onPipelineComplete', event, state);
    this.publish(state);
    return state;
  }

  /** Announce a terminal pipeline failure. */
  async dispatchPipelineFailure(event: PipelineFailureEvent): Promise<PipelineProgressState> {
    const state = this.ensureState(event.workId);
    state.status = 'failed';
    state.error = event.error;
    state.failedStep = event.stepKey ?? state.failedStep;
    state.finishedAt = new Date().toISOString();

    if (event.stepKey) {
      const step = this.ensureStep(state, event.stepKey);
      step.status = 'failed';
      if (!step.detail) step.detail = event.error;
      step.finishedAt = step.finishedAt || state.finishedAt;
    }

    this.reportProgress(event.stepKey || 'pipeline', 'failed', event.error, state);
    this.reportLog(
      'Pipeline',
      `Error in ${event.stepKey || 'pipeline'}: ${event.error}`,
      'error',
      state.workId,
    );

    await this.fanOut('onPipelineFailure', event, state);
    this.publish(state);
    return state;
  }

  // --- INTERNALS ---

  private ensureState(workId: string): PipelineProgressState {
    let state = this.pipelines.get(workId);
    if (!state) {
      state = {
        workId,
        title: workId,
        leadAgent: 'unknown',
        status: 'in_progress',
        percent: 0,
        steps: DEFAULT_PIPELINE_STEPS.map((step) => ({
          key: step.key,
          label: step.label,
          status: 'pending',
        })),
        startedAt: new Date().toISOString(),
      };
      this.pipelines.set(workId, state);
    }
    return state;
  }

  private ensureStep(
    state: PipelineProgressState,
    key: string,
    label?: string,
  ): ProgressStepState {
    let step = state.steps.find((candidate) => candidate.key === key);
    if (!step) {
      step = { key, label: label || key, status: 'pending' };
      state.steps.push(step);
    } else if (label) {
      step.label = label;
    }
    return step;
  }

  private recalc(state: PipelineProgressState): void {
    const total = state.steps.length;
    if (total === 0) {
      state.percent = state.status === 'completed' ? 100 : 0;
      return;
    }
    const settled = state.steps.filter(
      (step) => step.status === 'completed' || step.status === 'failed' || step.status === 'skipped',
    ).length;
    state.percent = clampPercent(Math.round((settled / total) * 100));
  }

  private reportProgress(
    step: string,
    status: string,
    detail: string | undefined,
    state: PipelineProgressState,
  ): void {
    if (!this.reporterService) return;
    // Keep the legacy 3-argument broadcast contract for the existing dashboard.
    this.reporterService.broadcastProgress(step, status, detail);
  }

  private reportLog(
    actor: string,
    message: string,
    level: string,
    workId: string,
  ): void {
    this.reporterService?.broadcastLog(actor, message, level, workId);
  }

  /** Push the full state snapshot to the live tracking page channel. */
  private publish(state: PipelineProgressState): void {
    this.reporterService?.broadcastEvent('pipeline', JSON.parse(JSON.stringify(state)));
  }

  /**
   * Fan an event out to every registered sink, sequentially. A failing sink is
   * logged and skipped so that channel outages can never break the pipeline.
   */
  private async fanOut(
    method:
      | 'onPipelineStart'
      | 'onStepStart'
      | 'onStepProgress'
      | 'onStepComplete'
      | 'onPipelineComplete'
      | 'onPipelineFailure',
    event: any,
    state: PipelineProgressState,
  ): Promise<void> {
    for (const sink of this.sinks.values()) {
      const handler = sink[method];
      if (typeof handler !== 'function') continue;
      try {
        await (handler as (event: any, state: PipelineProgressState) => unknown).call(
          sink,
          event,
          state,
        );
      } catch (err: any) {
        this.logger.warn(
          `ProgressSink "${sink.id}" failed in ${method}: ${err?.message || err}`,
        );
      }
    }
  }
}

function clampPercent(value: number): number {
  const safe = Number.isFinite(value) ? value : 0;
  return Math.min(100, Math.max(0, Math.round(safe)));
}
