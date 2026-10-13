import { TelegramAdapter, TelegramIncomingMessage } from '../src/adapters/telegram.adapter';
import { SignalStatus } from '../src/core';

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    adapter = new TelegramAdapter();
    jest.restoreAllMocks();
  });

  it('should parse incoming Telegram message into a canonical Signal', () => {
    const incoming: TelegramIncomingMessage = {
      message_id: 1042,
      from: {
        id: 6065829064,
        username: 'aLI',
        first_name: 'Ali',
      },
      chat: {
        id: 6065829064,
        type: 'private',
      },
      date: 1791871200,
      text: 'Please implement user payment refund workflow',
    };

    const signal = adapter.parseMessageToSignal(incoming);

    expect(signal.source).toBe('telegram');
    expect(signal.signalType).toBe('task_request');
    expect(signal.idempotencyKey).toBe('telegram:6065829064:1042');
    expect(signal.sourceRef).toBe('telegram://chat/6065829064/message/1042');
    expect(signal.status).toBe(SignalStatus.RECEIVED);
    expect(signal.payload.text).toBe('Please implement user payment refund workflow');
  });

  it('should fallback to caption if message text is absent', () => {
    const incoming: TelegramIncomingMessage = {
      message_id: 1045,
      chat: { id: 9999, type: 'private' },
      date: 1791871200,
      caption: 'Invoice screenshot with error code 500',
    };

    const signal = adapter.parseMessageToSignal(incoming);
    expect(signal.payload.text).toBe('Invoice screenshot with error code 500');
  });

  it('should recognize Telegram slash commands with arguments', () => {
    const incoming: TelegramIncomingMessage = {
      message_id: 1043,
      chat: { id: 12345, type: 'private' },
      date: 1791871200,
      text: '/status detailed',
    };

    const signal = adapter.parseMessageToSignal(incoming);
    expect(signal.signalType).toBe('command');
    expect(signal.payload.title).toBe('Command: /status');
  });

  it('should send telegram message successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ ok: true, result: { message_id: 200 } }),
    } as any);

    const success = await adapter.sendMessage('fake-token', 12345, 'Hello Ali!');
    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/botfake-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('should handle telegram API error gracefully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      }),
    } as any);

    const success = await adapter.sendMessage('fake-token', 12345, 'Hello Ali!');
    expect(success).toBe(false);
  });

  it('should handle network fetch exception gracefully', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network connection timeout'));

    const success = await adapter.sendMessage('fake-token', 12345, 'Hello Ali!');
    expect(success).toBe(false);
  });
});
