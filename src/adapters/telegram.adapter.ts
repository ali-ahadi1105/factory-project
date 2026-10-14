import { Injectable, Logger } from '@nestjs/common';
import { Signal, SignalStatus, CanonicalUri } from '../core';
import * as crypto from 'node:crypto';

export interface TelegramIncomingMessage {
  message_id: number;
  from?: {
    id: number;
    username?: string;
    first_name?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text?: string;
  caption?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramIncomingMessage;
}

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ProgressChecklistStep {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface ProgressNotificationState {
  title: string;
  currentStepIndex: number;
  steps: ProgressChecklistStep[];
  error?: string;
  prUrl?: string;
}

@Injectable()
export class TelegramAdapter {
  private readonly logger = new Logger(TelegramAdapter.name);

  /**
   * Convert a Telegram incoming message into a standard Software Factory Signal.
   */
  parseMessageToSignal(msg: TelegramIncomingMessage): Signal {
    const text = msg.text ?? msg.caption ?? '';
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    const idempotencyKey = `telegram:${chatId}:${messageId}`;
    const correlationId = crypto.randomUUID();

    const isCommand = text.startsWith('/');
    const signalType = isCommand ? 'command' : 'task_request';

    let occurredAt: string;
    try {
      occurredAt = msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString();
    } catch {
      occurredAt = new Date().toISOString();
    }

    return {
      id: crypto.randomUUID(),
      source: 'telegram',
      signalType,
      payload: {
        chatId,
        messageId,
        from: msg.from,
        text,
        title: isCommand ? `Command: ${text.split(' ')[0]}` : `Request from Telegram: ${text.slice(0, 40)}`,
        description: text,
      },
      sourceRef: CanonicalUri.telegramMessage(chatId, messageId),
      idempotencyKey,
      correlationId,
      status: SignalStatus.RECEIVED,
      occurredAt,
    };
  }

  /**
   * Send notification or message back to Telegram.
   */
  async sendMessage(
    botToken: string,
    chatId: number | string,
    text: string,
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML',
  ): Promise<boolean> {
    const messageId = await this.sendAndGetId(botToken, chatId, text, parseMode);
    return messageId !== null;
  }

  /**
   * Send message to Telegram and return the generated message_id.
   */
  async sendAndGetId(
    botToken: string,
    chatId: number | string,
    text: string,
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML',
  ): Promise<number | null> {
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const body: Record<string, any> = {
        chat_id: chatId,
        text,
      };
      if (parseMode) {
        body.parse_mode = parseMode;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const resJson = (await response.json()) as any;
      if (!resJson.ok || !resJson.result?.message_id) {
        this.logger.error(`Telegram API error: ${resJson.description || 'Unknown error'} (code ${resJson.error_code})`);
        return null;
      }

      return resJson.result.message_id as number;
    } catch (err: any) {
      this.logger.error(`Failed to send Telegram message to ${chatId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Edit an existing message in Telegram by message_id.
   */
  async editMessage(
    botToken: string,
    chatId: number | string,
    messageId: number,
    text: string,
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML',
  ): Promise<boolean> {
    try {
      const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
      const body: Record<string, any> = {
        chat_id: chatId,
        message_id: messageId,
        text,
      };
      if (parseMode) {
        body.parse_mode = parseMode;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const resJson = (await response.json()) as any;
      if (!resJson.ok) {
        this.logger.error(`Telegram editMessageText error: ${resJson.description || 'Unknown error'} (code ${resJson.error_code})`);
        return false;
      }

      return true;
    } catch (err: any) {
      this.logger.error(`Failed to edit Telegram message ${messageId} in ${chatId}: ${err.message}`);
      return false;
    }
  }

  /**
   * Format the live checklist state into user-friendly Markdown.
   */
  formatChecklistMessage(state: ProgressNotificationState): string {
    const lines: string[] = [
      `🏭 *Software Factory — روند اجرای وظیفه*`,
      `📌 *عنوان:* ${state.title}`,
      '',
    ];

    for (const step of state.steps) {
      let icon = '⬜';
      if (step.status === 'completed') icon = '✅';
      else if (step.status === 'in_progress') icon = '⏳';
      else if (step.status === 'failed') icon = '❌';

      let line = `${icon} ${step.label}`;
      if (step.detail) {
        line += ` _(${step.detail})_`;
      }
      lines.push(line);
    }

    lines.push('');
    if (state.error) {
      lines.push(`❌ *خطا در اجرا:* ${state.error}`);
    } else if (state.prUrl) {
      lines.push(`🎉 *عملیات با موفقیت پایان یافت!*`);
      lines.push(`🔗 [مشاهده Pull Request](${state.prUrl})`);
    } else {
      const current = state.steps.find((s) => s.status === 'in_progress');
      if (current) {
        lines.push(`⏳ *در حال اجرا:* ${current.label}...`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Create an interactive progress session for a task run.
   */
  createProgressSession(
    botToken: string,
    chatId: number | string,
    title: string,
    steps: { key: string; label: string }[],
  ): TelegramProgressSession {
    return new TelegramProgressSession(this, botToken, chatId, title, steps);
  }
}

/**
 * Controller class managing the lifecycle of an editable checklist message in Telegram.
 */
export class TelegramProgressSession {
  private messageId: number | null = null;
  private state: ProgressNotificationState;

  constructor(
    private readonly adapter: TelegramAdapter,
    private readonly botToken: string,
    private readonly chatId: number | string,
    title: string,
    stepDefinitions: { key: string; label: string }[],
  ) {
    this.state = {
      title,
      currentStepIndex: 0,
      steps: stepDefinitions.map((s) => ({
        key: s.key,
        label: s.label,
        status: 'pending',
      })),
    };
  }

  getMessageId(): number | null {
    return this.messageId;
  }

  getState(): ProgressNotificationState {
    return this.state;
  }

  async start(): Promise<void> {
    const text = this.adapter.formatChecklistMessage(this.state);
    this.messageId = await this.adapter.sendAndGetId(this.botToken, this.chatId, text, 'Markdown');
  }

  async setStepInProgress(key: string, detail?: string): Promise<void> {
    const step = this.state.steps.find((s) => s.key === key);
    if (step) {
      step.status = 'in_progress';
      if (detail) step.detail = detail;
      await this.sync();
    }
  }

  async completeStep(key: string, detail?: string): Promise<void> {
    const step = this.state.steps.find((s) => s.key === key);
    if (step) {
      step.status = 'completed';
      if (detail) step.detail = detail;
      await this.sync();
    }
  }

  async fail(error: string, failedKey?: string): Promise<void> {
    if (failedKey) {
      const step = this.state.steps.find((s) => s.key === failedKey);
      if (step) step.status = 'failed';
    }
    this.state.error = error;
    await this.sync();
  }

  async finish(prUrl?: string): Promise<void> {
    if (prUrl) {
      this.state.prUrl = prUrl;
    }
    await this.sync();
  }

  private async sync(): Promise<void> {
    if (!this.messageId) return;
    const text = this.adapter.formatChecklistMessage(this.state);
    await this.adapter.editMessage(this.botToken, this.chatId, this.messageId, text, 'Markdown');
  }
}
