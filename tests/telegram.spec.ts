import {
  TelegramAdapter,
  TelegramIncomingMessage,
  TelegramProgressSession,
} from '../src/adapters/telegram.adapter';
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

  it('should send telegram message and return boolean', async () => {
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

  it('should send message and return generated messageId', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ ok: true, result: { message_id: 888 } }),
    } as any);

    const messageId = await adapter.sendAndGetId('fake-token', 12345, 'Task Started');
    expect(messageId).toBe(888);
  });

  it('should edit existing telegram message successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ ok: true, result: { message_id: 888 } }),
    } as any);

    const success = await adapter.editMessage('fake-token', 12345, 888, 'Task Step Updated');
    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/botfake-token/editMessageText',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chat_id: 12345,
          message_id: 888,
          text: 'Task Step Updated',
        }),
      }),
    );
  });

  it('should format checklist message correctly with status icons', () => {
    const text = adapter.formatChecklistMessage({
      title: 'Build Payment Gateway',
      currentStepIndex: 1,
      steps: [
        { key: 'issue', label: 'Create Issue', status: 'completed', detail: '#42' },
        { key: 'branch', label: 'Create Branch', status: 'in_progress', detail: 'feature/pay' },
        { key: 'test', label: 'Run Tests', status: 'pending' },
      ],
    });

    expect(text).toContain('🏭 *Software Factory — روند اجرای وظیفه*');
    expect(text).toContain('📌 *عنوان:* Build Payment Gateway');
    expect(text).toContain('✅ Create Issue _(#42)_');
    expect(text).toContain('⏳ Create Branch _(feature/pay)_');
    expect(text).toContain('⬜ Run Tests');
    expect(text).toContain('⏳ *در حال اجرا:* Create Branch...');
  });

  it('should manage live progress session lifecycle via TelegramProgressSession', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        json: () => Promise.resolve({ ok: true, result: { message_id: 777 } }),
      });
    });

    const session = adapter.createProgressSession('fake-token', 12345, 'Deploy Service', [
      { key: 'step1', label: 'Step 1: Init' },
      { key: 'step2', label: 'Step 2: Deploy' },
    ]);

    await session.start();
    expect(session.getMessageId()).toBe(777);
    expect(callCount).toBe(1);

    await session.setStepInProgress('step1', 'Running init');
    expect(callCount).toBe(2);

    await session.completeStep('step1', 'Done');
    expect(callCount).toBe(3);

    await session.finish('https://github.com/ali-ahadi1105/factory-project/pull/10');
    expect(callCount).toBe(4);
    expect(session.getState().prUrl).toBe('https://github.com/ali-ahadi1105/factory-project/pull/10');
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
