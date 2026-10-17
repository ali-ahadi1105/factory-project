import {
  ProgressDispatcherService,
  ProgressSink,
  PipelineStartEvent,
  StepStartEvent,
  StepProgressEvent,
  StepCompleteEvent,
  PipelineCompleteEvent,
  PipelineFailureEvent,
  PipelineProgressState,
  formatProgressBar,
  DEFAULT_PIPELINE_STEPS,
} from '../src/engine/progress.service';
import { TelegramProgressSink } from '../src/adapters/telegram-progress.sink';
import { TelegramAdapter } from '../src/adapters/telegram.adapter';
import { ReporterService } from '../src/engine/reporter.service';

describe('Universal Multi-Channel Progress Engine', () => {
  describe('formatProgressBar helper', () => {
    it('formats 0% correctly', () => {
      expect(formatProgressBar(0, 10)).toBe('░░░░░░░░░░');
    });

    it('formats 50% correctly', () => {
      expect(formatProgressBar(50, 10)).toBe('█████░░░░░');
    });

    it('formats 100% correctly', () => {
      expect(formatProgressBar(100, 10)).toBe('██████████');
    });

    it('handles negative or invalid percent by clamping to 0', () => {
      expect(formatProgressBar(-20, 5)).toBe('░░░░░');
      expect(formatProgressBar(NaN, 5)).toBe('░░░░░');
    });

    it('handles percent > 100 by clamping to 100', () => {
      expect(formatProgressBar(150, 5)).toBe('█████');
    });

    it('defaults to 20 blocks if totalBlocks omitted', () => {
      const bar = formatProgressBar(50);
      expect(bar).toHaveLength(20);
      expect(bar).toBe('██████████░░░░░░░░░░');
    });
  });

  describe('ProgressDispatcherService', () => {
    let dispatcher: ProgressDispatcherService;
    let mockReporter: jest.Mocked<ReporterService>;

    beforeEach(() => {
      mockReporter = {
        broadcastProgress: jest.fn(),
        broadcastLog: jest.fn(),
        broadcastEvent: jest.fn(),
      } as any;
      dispatcher = new ProgressDispatcherService(mockReporter);
    });

    it('registers, retrieves, lists, unregisters and clears sinks', () => {
      const sink1: ProgressSink = { id: 'sink-1' };
      const sink2: ProgressSink = { id: 'sink-2' };

      dispatcher.registerSink(sink1).registerSink(sink2);
      expect(dispatcher.listSinks()).toEqual([sink1, sink2]);
      expect(dispatcher.getSink('sink-1')).toBe(sink1);

      expect(dispatcher.unregisterSink('sink-1')).toBe(true);
      expect(dispatcher.getSink('sink-1')).toBeUndefined();
      expect(dispatcher.listSinks()).toEqual([sink2]);

      dispatcher.clearSinks();
      expect(dispatcher.listSinks()).toHaveLength(0);
    });

    it('throws when registering a sink without an id', () => {
      expect(() => dispatcher.registerSink({} as any)).toThrow();
    });

    it('dispatches lifecycle events sequentially to registered sinks and updates state', async () => {
      const calls: string[] = [];
      const testSink: ProgressSink = {
        id: 'test-sink',
        onPipelineStart: jest.fn(async () => {
          calls.push('start');
        }),
        onStepStart: jest.fn(async () => {
          calls.push('step-start');
        }),
        onStepProgress: jest.fn(async () => {
          calls.push('step-progress');
        }),
        onStepComplete: jest.fn(async () => {
          calls.push('step-complete');
        }),
        onPipelineComplete: jest.fn(async () => {
          calls.push('complete');
        }),
      };

      dispatcher.registerSink(testSink);

      const workId = 'work-test-123';
      const liveUrl = 'http://localhost:3000/live/work-test-123';

      // 1. Pipeline Start
      const startState = await dispatcher.dispatchPipelineStart({
        workId,
        title: 'Feature X',
        leadAgent: 'opencode',
        liveUrl,
      });

      expect(startState.workId).toBe(workId);
      expect(startState.leadAgent).toBe('opencode');
      expect(startState.liveUrl).toBe(liveUrl);
      expect(startState.status).toBe('in_progress');
      expect(startState.percent).toBe(0);
      expect(startState.steps).toHaveLength(DEFAULT_PIPELINE_STEPS.length);
      expect(testSink.onPipelineStart).toHaveBeenCalledTimes(1);
      expect(mockReporter.broadcastEvent).toHaveBeenCalledWith('pipeline', expect.objectContaining({ workId }));
      expect(mockReporter.broadcastLog).toHaveBeenCalledWith(
        'Pipeline',
        expect.stringContaining('Pipeline started'),
        'info',
        workId,
      );

      // 2. Step Start
      await dispatcher.dispatchStepStart({
        workId,
        stepKey: 'issue',
        detail: 'Creating issue #42',
      });
      expect(testSink.onStepStart).toHaveBeenCalledTimes(1);
      const stateAfterStepStart = dispatcher.getPipelineState(workId);
      expect(stateAfterStepStart?.steps.find((s) => s.key === 'issue')?.status).toBe('in_progress');

      // 3. Step Progress
      await dispatcher.dispatchStepProgress({
        workId,
        stepKey: 'issue',
        percent: 15,
        message: 'Calling GitHub API',
      });
      expect(testSink.onStepProgress).toHaveBeenCalledTimes(1);
      expect(dispatcher.getPipelineState(workId)?.percent).toBe(15);
      expect(mockReporter.broadcastLog).toHaveBeenCalledWith('Pipeline', 'Calling GitHub API', 'info', workId);

      // 4. Step Complete
      await dispatcher.dispatchStepComplete({
        workId,
        stepKey: 'issue',
        detail: '#42',
      });
      expect(testSink.onStepComplete).toHaveBeenCalledTimes(1);
      const stateAfterStepComplete = dispatcher.getPipelineState(workId);
      expect(stateAfterStepComplete?.steps.find((s) => s.key === 'issue')?.status).toBe('completed');

      // 5. Pipeline Complete
      await dispatcher.dispatchPipelineComplete({
        workId,
        prUrl: 'https://github.com/org/repo/pull/1',
        issueUrl: 'https://github.com/org/repo/issues/42',
        testPassed: true,
      });
      expect(testSink.onPipelineComplete).toHaveBeenCalledTimes(1);
      const finalState = dispatcher.getPipelineState(workId);
      expect(finalState?.status).toBe('completed');
      expect(finalState?.percent).toBe(100);
      expect(finalState?.prUrl).toBe('https://github.com/org/repo/pull/1');

      expect(calls).toEqual(['start', 'step-start', 'step-progress', 'step-complete', 'complete']);
    });

    it('handles pipeline failures and propagates failure state', async () => {
      const failureSink: ProgressSink = {
        id: 'failure-sink',
        onPipelineFailure: jest.fn(),
      };
      dispatcher.registerSink(failureSink);

      const workId = 'work-fail-999';
      await dispatcher.dispatchPipelineStart({
        workId,
        title: 'Failing Job',
        leadAgent: 'claude',
      });

      await dispatcher.dispatchPipelineFailure({
        workId,
        error: 'Unit test suite failed with 2 errors',
        stepKey: 'test',
      });

      expect(failureSink.onPipelineFailure).toHaveBeenCalledTimes(1);
      const state = dispatcher.getPipelineState(workId);
      expect(state?.status).toBe('failed');
      expect(state?.error).toBe('Unit test suite failed with 2 errors');
      expect(state?.failedStep).toBe('test');
      expect(state?.steps.find((s) => s.key === 'test')?.status).toBe('failed');
      expect(mockReporter.broadcastProgress).toHaveBeenCalledWith(
        'test',
        'failed',
        'Unit test suite failed with 2 errors',
      );
    });

    it('degrades gracefully when a sink callback throws/rejects', async () => {
      const badSink: ProgressSink = {
        id: 'broken-sink',
        onStepStart: jest.fn(() => {
          throw new Error('Sink network timeout');
        }),
      };
      const goodSink: ProgressSink = {
        id: 'good-sink',
        onStepStart: jest.fn(),
      };

      dispatcher.registerSink(badSink).registerSink(goodSink);

      await expect(
        dispatcher.dispatchStepStart({ workId: 'work-graceful', stepKey: 'implement' }),
      ).resolves.toBeDefined();

      expect(goodSink.onStepStart).toHaveBeenCalledTimes(1);
    });
  });

  describe('TelegramProgressSink', () => {
    let mockAdapter: jest.Mocked<TelegramAdapter>;

    beforeEach(() => {
      mockAdapter = {
        sendAndGetId: jest.fn().mockResolvedValue(12345),
        editMessage: jest.fn().mockResolvedValue(true),
        sendMessage: jest.fn().mockResolvedValue(true),
      } as any;
    });

    it('sends immediate acknowledgement (<1s) with workId, title, leadAgent and liveUrl', async () => {
      let currentTime = 1000;
      const sink = new TelegramProgressSink({
        adapter: mockAdapter,
        botToken: 'bot-token',
        chatId: 98765,
        workId: 'work-telegram-1',
        title: 'Universal Multi-Channel Progress Engine',
        leadAgent: 'opencode',
        liveUrl: 'http://localhost:3000/live/work-telegram-1',
        now: () => {
          currentTime += 50; // simulated 50ms network round-trip
          return currentTime;
        },
      });

      const sampleState: PipelineProgressState = {
        workId: 'work-telegram-1',
        title: 'Universal Multi-Channel Progress Engine',
        leadAgent: 'opencode',
        liveUrl: 'http://localhost:3000/live/work-telegram-1',
        status: 'in_progress',
        percent: 0,
        steps: DEFAULT_PIPELINE_STEPS.map((s) => ({ ...s, status: 'pending' })),
        startedAt: new Date().toISOString(),
      };

      await sink.onPipelineStart(
        {
          workId: sampleState.workId,
          title: sampleState.title,
          leadAgent: sampleState.leadAgent,
          liveUrl: sampleState.liveUrl,
        },
        sampleState,
      );

      expect(mockAdapter.sendAndGetId).toHaveBeenCalledTimes(1);
      const sentText = mockAdapter.sendAndGetId.mock.calls[0][2];
      expect(sentText).toContain('work-telegram-1');
      expect(sentText).toContain('Universal Multi-Channel Progress Engine');
      expect(sentText).toContain('opencode');
      expect(sentText).toContain('http://localhost:3000/live/work-telegram-1');
      expect(sentText).toContain('0%');

      expect(sink.getMessageId()).toBe(12345);
      expect(sink.getAckLatencyMs()).toBeLessThan(1000);
    });

    it('always edits on stage transitions but coalesces intra-step progress', async () => {
      let currentTime = 1000;
      const sink = new TelegramProgressSink({
        adapter: mockAdapter,
        botToken: 'bot-token',
        chatId: 98765,
        workId: 'work-telegram-throttle',
        title: 'Throttled Task',
        leadAgent: 'claude',
        minEditIntervalMs: 500,
        now: () => currentTime,
      });

      const state: PipelineProgressState = {
        workId: 'work-telegram-throttle',
        title: 'Throttled Task',
        leadAgent: 'claude',
        status: 'in_progress',
        percent: 0,
        steps: DEFAULT_PIPELINE_STEPS.map((s) => ({ ...s, status: 'pending' })),
        startedAt: new Date().toISOString(),
      };

      await sink.onPipelineStart({ workId: state.workId, title: state.title, leadAgent: state.leadAgent }, state);

      // Entering a new stage is a lifecycle transition: it must render even when
      // it lands inside the coalescing window.
      currentTime += 100;
      state.steps[0].status = 'in_progress';
      await sink.onStepStart({ workId: state.workId, stepKey: 'issue' }, state);
      expect(mockAdapter.editMessage).toHaveBeenCalledTimes(1);

      // Rapid intra-step progress within the window is coalesced (no edit yet).
      currentTime += 50;
      state.steps[0].detail = 'in progress a';
      await sink.onStepProgress({ workId: state.workId, stepKey: 'issue', percent: 5 }, state);
      currentTime += 50;
      state.steps[0].detail = 'in progress b';
      await sink.onStepProgress({ workId: state.workId, stepKey: 'issue', percent: 8 }, state);
      expect(mockAdapter.editMessage).toHaveBeenCalledTimes(1);

      // Once minEditIntervalMs elapses the latest progress is flushed.
      currentTime += 600;
      state.percent = 12;
      state.steps[0].detail = 'in progress c';
      await sink.onStepProgress({ workId: state.workId, stepKey: 'issue', percent: 12 }, state);
      expect(mockAdapter.editMessage).toHaveBeenCalledTimes(2);
      expect(mockAdapter.editMessage.mock.calls[1][3]).toContain('12%');

      // Step complete forces an edit regardless of throttle
      currentTime += 50;
      state.steps[0].status = 'completed';
      await sink.onStepComplete({ workId: state.workId, stepKey: 'issue' }, state);
      expect(mockAdapter.editMessage).toHaveBeenCalledTimes(3);

      // Pipeline complete also forces an edit
      currentTime += 50;
      state.status = 'completed';
      state.prUrl = 'https://github.com/org/repo/pull/42';
      await sink.onPipelineComplete({ workId: state.workId, prUrl: state.prUrl }, state);
      expect(mockAdapter.editMessage).toHaveBeenCalledTimes(4);

      const lastEditText = mockAdapter.editMessage.mock.calls[3][3];
      expect(lastEditText).toContain('Pipeline completed successfully');
      expect(lastEditText).toContain('https://github.com/org/repo/pull/42');
    });

    it('renders every pipeline stage (implement, review, test, pr) and finishes at 100% with the PR link', async () => {
      const sink = new TelegramProgressSink({
        adapter: mockAdapter,
        botToken: 'bot-token',
        chatId: 98765,
        workId: 'work-telegram-e2e',
        title: 'End to end pipeline',
        leadAgent: 'opencode',
        liveUrl: 'http://localhost:3000/live/work-telegram-e2e',
        // No throttle so the dispatcher fan-out is deterministic.
        minEditIntervalMs: 0,
      });
      const dispatcher = new ProgressDispatcherService();
      dispatcher.registerSink(sink);

      const workId = 'work-telegram-e2e';
      await dispatcher.dispatchPipelineStart({
        workId,
        title: 'End to end pipeline',
        leadAgent: 'opencode',
        liveUrl: 'http://localhost:3000/live/work-telegram-e2e',
      });

      const stageKeys = ['issue', 'branch', 'implement', 'review', 'test', 'pr'];
      for (const stepKey of stageKeys) {
        await dispatcher.dispatchStepStart({ workId, stepKey, detail: `start ${stepKey}` });
        await dispatcher.dispatchStepComplete({ workId, stepKey, detail: `done ${stepKey}` });
      }

      // Every stage transition produced an edit.
      expect(mockAdapter.editMessage.mock.calls.length).toBe(stageKeys.length * 2);

      const allRendered = mockAdapter.editMessage.mock.calls.map((call) => call[3]).join('\n');
      expect(allRendered).toContain('پیاده‌سازی کد');
      expect(allRendered).toContain('بازبینی و ممیزی کد');
      expect(allRendered).toContain('اجرای تست‌های خودکار');
      expect(allRendered).toContain('ساخت Pull Request');

      const prUrl = 'https://github.com/ali-ahadi1105/factory-project/pull/27';
      await dispatcher.dispatchPipelineComplete({ workId, prUrl, testPassed: true });

      const finalMessage = mockAdapter.editMessage.mock.calls.at(-1)![3];
      expect(finalMessage).toContain('100%');
      expect(finalMessage).toContain('Pipeline completed successfully');
      expect(finalMessage).toContain('View Pull Request');
      expect(finalMessage).toContain(prUrl);
    });
  });
});
