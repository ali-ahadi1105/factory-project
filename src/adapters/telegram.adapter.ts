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
      if (!resJson.ok) {
        this.logger.error(`Telegram API error: ${resJson.description || 'Unknown error'} (code ${resJson.error_code})`);
        return false;
      }

      return true;
    } catch (err: any) {
      this.logger.error(`Failed to send Telegram message to ${chatId}: ${err.message}`);
      return false;
    }
  }
}
