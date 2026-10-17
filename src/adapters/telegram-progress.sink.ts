import { Logger } from '@nestjs/common';
import { TelegramAdapter } from './telegram.adapter';
import {
  PipelineCompleteEvent,
  PipelineFailureEvent,
  PipelineProgressState,
  PipelineStartEvent,
  ProgressSink,
  ProgressStepState,
  StepCompleteEvent,
  StepProgressEvent,
  StepStartEvent,
  formatProgressBar,
} from '../engine/progress.service';

export interface TelegramProgressSinkOptions {
  /** Telegram adapter used to talk to the Bot API (injected for testability). */
  adapter: TelegramAdapter;
  botToken: string;
  chatId: number | string;
  workId: string;
  title: string;
  /** Lead agent responsible for the implementation stage. */
  leadAgent: string;
  /** Public URL of the live web tracking page. */
  liveUrl?: string;
  /** Number of blocks used to render the progress bar (default 20). */
  totalBlocks?: number;
  /**
   * Minimum delay between two consecutive message edits. Telegram rate-limits
   * edits aggressively, so intermediate updates are coalesced. Terminal
   * transitions always bypass the throttle. Defaults to 700ms.
   */
  minEditIntervalMs?: number;
  /** Injectable clock (ms) to keep tests deterministic. */
  now?: () => number;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Telegram channel sink.
 *
 * Behaviour required by Concept v31:
 *  1. Immediate acknowledgement (< 1s) containing the Work ID, title, lead agent
 *     and the live web tracking URL.
 *  2. Progressive edits of that same message with an animated progress bar and a
 *     live checklist as the pipeline advances.
 */
export class TelegramProgressSink implements ProgressSink {
  readonly id: string;
  private readonly logger = new Logger(TelegramProgressSink.name);
  private readonly adapter: TelegramAdapter;
  private readonly botToken: string;
  private readonly chatId: number | string;
  private readonly workId: string;
  private readonly title: string;
  private readonly leadAgent: string;
  private readonly liveUrl?: string;
  private readonly totalBlocks: number;
  private readonly minEditIntervalMs: number;
  private readonly now: () => number;

  private messageId: number | null = null;
  private editCount = 0;
  private lastEditAt = 0;
  private lastRendered: string | null = null;
  private ackLatencyMs: number | null = null;

  constructor(options: TelegramProgressSinkOptions) {
    this.adapter = options.adapter;
    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.workId = options.workId;
    this.title = options.title;
    this.leadAgent = options.leadAgent;
    this.liveUrl = options.liveUrl;
    this.totalBlocks = options.totalBlocks ?? 20;
    this.minEditIntervalMs = options.minEditIntervalMs ?? 700;
    this.now = options.now ?? (() => Date.now());
    this.id = `telegram:${options.chatId}:${options.workId}`;
  }

  getMessageId(): number | null {
    return this.messageId;
  }

  getEditCount(): number {
    return this.editCount;
  }

  /** Time between dispatch of the ack and the Telegram API response, in ms. */
  getAckLatencyMs(): number | null {
    return this.ackLatencyMs;
  }

  getLiveUrl(): string | undefined {
    return this.liveUrl;
  }

  getWorkId(): string {
    return this.workId;
  }

  // --- PROGRESS SINK CONTRACT ---

  async onPipelineStart(event: PipelineStartEvent, state: PipelineProgressState): Promise<void> {
    const text = this.render(state);
    const startedAt = this.now();
    this.messageId = await this.adapter.sendAndGetId(
      this.botToken,
      this.chatId,
      text,
      'Markdown',
    );
    const finishedAt = this.now();
    this.ackLatencyMs = finishedAt - startedAt;
    this.lastEditAt = finishedAt;
    this.lastRendered = text;

    if (this.messageId === null) {
      this.logger.warn(
        `Immediate Telegram ack failed for work ${this.workId} (chat ${this.chatId}).`,
      );
    }
  }

  async onStepStart(_event: StepStartEvent, state: PipelineProgressState): Promise<void> {
    // Lifecycle transitions (entering a new stage: implement, review, test, pr)
    // must always be visible, otherwise a long-running stage would leave the
    // message stuck on the previous stage for minutes because the transition
    // landed inside the coalescing window. Only intra-step progress is throttled.
    await this.sync(state, { force: true });
  }

  async onStepProgress(_event: StepProgressEvent, state: PipelineProgressState): Promise<void> {
    await this.sync(state);
  }

  async onStepComplete(_event: StepCompleteEvent, state: PipelineProgressState): Promise<void> {
    await this.sync(state, { force: true });
  }

  async onPipelineComplete(
    _event: PipelineCompleteEvent,
    state: PipelineProgressState,
  ): Promise<void> {
    await this.sync(state, { force: true });
  }

  async onPipelineFailure(
    _event: PipelineFailureEvent,
    state: PipelineProgressState,
  ): Promise<void> {
    await this.sync(state, { force: true });
  }

  // --- RENDERING ---

  /**
   * Render the full live message: header (work id, title, lead agent, live URL),
   * animated progress bar, checklist and a status footer.
   */
  render(state: PipelineProgressState, ack = false): string {
    const percent = this.resolvePercent(state);
    const bar = formatProgressBar(percent, this.totalBlocks);
    const spinner = this.spinner(state);
    const lines: string[] = [];

    lines.push('🏭 *Software Factory — Live Progress*');
    lines.push(`📌 *${escapeMarkdown(this.title)}*`);
    lines.push(`🆔 Work ID: \`${this.workId}\``);
    lines.push(`🤖 Lead agent: \`${escapeMarkdown(this.leadAgent)}\``);
    if (this.liveUrl) {
      lines.push(`🌐 [Live tracking](${this.liveUrl})`);
    }
    lines.push('');
    lines.push(`${spinner} \`[${bar}]\` *${percent}%* (${this.settledCount(state)}/${state.steps.length})`);
    lines.push('');

    for (const step of state.steps) {
      lines.push(`${icon(step)} ${escapeMarkdown(step.label)}${stepLineSuffix(step)}`);
    }

    lines.push('');
    if (state.status === 'failed') {
      lines.push(`❌ *Pipeline failed${state.failedStep ? ` at ${state.failedStep}` : ''}:* ${escapeMarkdown(state.error || 'unknown error')}`);
    } else if (state.status === 'completed') {
      lines.push('🎉 *Pipeline completed successfully!*');
      if (state.prUrl) {
        lines.push(`🔗 [View Pull Request](${state.prUrl})`);
      }
    } else if (ack) {
      lines.push('⚡ *Acknowledged — starting pipeline now...*');
    } else {
      const active = state.steps.find((step) => step.status === 'in_progress');
      if (active) {
        lines.push(`⏳ *Running:* ${escapeMarkdown(active.label)}...`);
      }
    }

    return lines.join('\n');
  }

  // --- INTERNAL HELPERS ---

  private async sync(state: PipelineProgressState, options: { force?: boolean } = {}): Promise<void> {
    if (this.messageId === null) return;

    const text = this.render(state);
    if (text === this.lastRendered) return;

    const due = this.now() - this.lastEditAt >= this.minEditIntervalMs;
    if (!options.force && !due) return;

    const ok = await this.adapter.editMessage(
      this.botToken,
      this.chatId,
      this.messageId,
      text,
      'Markdown',
    );
    if (ok) {
      this.lastEditAt = this.now();
      this.editCount++;
      this.lastRendered = text;
    }
  }

  private resolvePercent(state: PipelineProgressState): number {
    if (state.status === 'completed') return 100;
    return Math.min(100, Math.max(0, Math.round(state.percent)));
  }

  private settledCount(state: PipelineProgressState): number {
    return state.steps.filter(
      (step) => step.status === 'completed' || step.status === 'failed' || step.status === 'skipped',
    ).length;
  }

  private spinner(state: PipelineProgressState): string {
    if (state.status === 'completed') return '✅';
    if (state.status === 'failed') return '❌';
    return SPINNER_FRAMES[this.editCount % SPINNER_FRAMES.length];
  }
}

function icon(step: ProgressStepState): string {
  switch (step.status) {
    case 'completed':
      return '✅';
    case 'in_progress':
      return '⏳';
    case 'failed':
      return '❌';
    case 'skipped':
      return '⏭️';
    default:
      return '⬜';
  }
}

function stepLineSuffix(step: ProgressStepState): string {
  return step.detail ? ` _(${escapeMarkdown(step.detail)})_` : '';
}

/** Escape the subset of Telegram legacy-Markdown control characters. */
function escapeMarkdown(value: string): string {
  return String(value ?? '')
    .replace(/([_*`\[])/g, '\\$1');
}
