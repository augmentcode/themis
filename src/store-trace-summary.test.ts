import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from './react-store';
import { Store } from './svelte-store';
import { StreamingStore } from './streaming-store';
import type { SelectorTraceSummary } from './types';

vi.mock('./utils/runtime-svelte/utils', () => ({
  getStoreContext: vi.fn(() => undefined),
  getDispatch: vi.fn(),
}));

const counterReducer = Object.assign(
  (state = { count: 0 }) => state,
  { initialState: { count: 0 } }
);
type CounterState = { counter: { count: number } };
const selectorFunc = (state: CounterState) => state.counter.count;

const createSummaryStore = () =>
  new Store(
    { counter: counterReducer },
    undefined,
    { traceSelectors: { summaryEnabled: true, summaryIntervalMs: 25 } }
  );

describe('selector trace summaries', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aggregates bounded durations, recomputations, reasons, outcomes, and cache ratios', () => {
    const store = createSummaryStore();
    const reporter = store.getSelectorTraceReporter<CounterState, number>()!;

    for (let duration = 1; duration <= 70; duration += 1) {
      reporter({
        selectorFunc,
        recomputationCount: duration,
        executionDurationMs: duration,
        invalidationReason: duration === 1 ? 'first-execution' : 'accessed-state-paths-changed',
        resultOutcome: duration === 1 ? 'initial' : duration === 70 ? 'retained-reference' : 'changed',
      });
    }
    for (const outputCacheStatus of ['miss', 'hit', 'hit'] as const) {
      reporter({
        selectorFunc,
        observableCacheRequestCount: 0,
        observableCacheCachedCount: 0,
        outputCacheStatus,
        outputCacheRequestCount: 0,
        outputCacheHitCount: 0,
        outputCacheMissCount: 0,
      });
    }

    const [summary] = store.getSelectorTraceSummary();
    expect(summary).toEqual({
      selectorSource: expect.stringContaining('state.counter.count'),
      executionCount: 70,
      recomputationCount: 70,
      invalidationReasons: {
        'first-execution': 1,
        'selector-arguments-changed': 0,
        'accessed-state-paths-changed': 69,
        'previous-result-unavailable': 0,
      },
      resultOutcomes: { initial: 1, changed: 68, 'retained-reference': 1 },
      duration: { count: 70, totalMs: 2485, averageMs: 35.5, maximumMs: 70, p95Ms: 67 },
      cache: { requestCount: 3, hitCount: 2, missCount: 1, hitRatio: 2 / 3 },
    });
  });

  it('returns deep-frozen snapshots without resetting collector state', () => {
    const store = createSummaryStore();
    store.getSelectorTraceReporter<CounterState, number>()!({
      selectorFunc,
      recomputationCount: 1,
      executionDurationMs: 2,
      invalidationReason: 'first-execution',
      resultOutcome: 'initial',
    });

    const first: SelectorTraceSummary = store.getSelectorTraceSummary();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0].duration)).toBe(true);
    expect(Object.isFrozen(first[0].cache)).toBe(true);
    expect(() => (first as any).push({})).toThrow();
    expect(() => ((first[0].duration as any).count = 99)).toThrow();
    expect(store.getSelectorTraceSummary()).toEqual(first);
  });

  it('reports period deltas, stays silent when idle, and stops on disposal', () => {
    vi.useFakeTimers();
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const store = createSummaryStore();
    expect(vi.getTimerCount()).toBe(0);
    const reporter = store.getSelectorTraceReporter<CounterState, number>()!;
    const dispose = store.init();
    expect(vi.getTimerCount()).toBe(1);
    store.init();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(25);
    expect(consoleInfo).not.toHaveBeenCalled();

    store.getSelectorTraceReporter<CounterState, number>()!({
      selectorFunc,
      recomputationCount: 1,
      executionDurationMs: 2,
      invalidationReason: 'first-execution',
      resultOutcome: 'initial',
    });
    vi.advanceTimersByTime(25);
    expect(consoleInfo).toHaveBeenCalledTimes(1);
    const [format] = consoleInfo.mock.calls[0];
    const aggregate = consoleInfo.mock.calls[0].at(-1);
    expect(format).toContain('[themis] selector trace summary');
    expect(aggregate).toEqual(expect.objectContaining({
      intervalMs: 25,
      selectors: [expect.objectContaining({
        selectorSource: expect.stringContaining('state.counter.count'),
        recomputationCount: 1,
      })],
    }));
    expect(store.getSelectorTraceSummary()[0]).toEqual(expect.objectContaining({
      executionCount: 1,
      duration: expect.objectContaining({ totalMs: 2 }),
    }));
    const callsAfterFirstInterval = consoleInfo.mock.calls.length;

    reporter({
      selectorFunc,
      recomputationCount: 2,
      executionDurationMs: 3,
      invalidationReason: 'accessed-state-paths-changed',
      resultOutcome: 'changed',
    });
    vi.advanceTimersByTime(25);
    expect(consoleInfo.mock.calls).toHaveLength(callsAfterFirstInterval + 1);
    expect(consoleInfo.mock.calls.at(-1)?.at(-1)).toEqual(expect.objectContaining({
      selectors: [expect.objectContaining({
        executionCount: 1,
        recomputationCount: 1,
        duration: expect.objectContaining({ totalMs: 3 }),
      })],
    }));
    expect(store.getSelectorTraceSummary()[0]).toEqual(expect.objectContaining({
      executionCount: 2,
      duration: expect.objectContaining({ totalMs: 5 }),
    }));

    const callsAfterSecondInterval = consoleInfo.mock.calls.length;
    vi.advanceTimersByTime(25);
    expect(consoleInfo.mock.calls).toHaveLength(callsAfterSecondInterval);

    dispose();
    vi.advanceTimersByTime(100);
    expect(consoleInfo).toHaveBeenCalledTimes(callsAfterSecondInterval);
  });

  it('collects summary-only events without emitting category trace logs', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const store = createSummaryStore();
    store.getSelectorTraceReporter<CounterState, number>()!({
      selectorFunc,
      recomputationCount: 1,
      executionDurationMs: 1,
      invalidationReason: 'first-execution',
      resultOutcome: 'initial',
    });

    expect(store.getSelectorTraceSummary()[0].executionCount).toBe(1);
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  it('collects execution and cache summaries when threshold filters suppress console records', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const store = new Store(undefined, undefined, {
      traceSelectors: {
        traceExecution: true,
        traceCache: true,
        minDurationMs: 10,
        minRecomputationCount: 10,
        minCacheMissCount: 10,
        summaryEnabled: true,
      },
    });
    const selectorFunc = (state: { count: number }) => state.count;
    store.getSelectorTraceReporter()!({
      selectorFunc,
      recomputationCount: 1,
      executionDurationMs: 1,
      accessedPaths: new Set(['["count"]']),
      parsedPaths: new Map([['["count"]', ['count']]]),
    });
    store.getSelectorTraceReporter()!({
      selectorFunc,
      observableCacheRequestCount: 1,
      observableCacheCachedCount: 1,
      outputCacheStatus: 'miss',
      outputCacheRequestCount: 1,
      outputCacheHitCount: 0,
      outputCacheMissCount: 1,
    });

    expect(consoleInfo).not.toHaveBeenCalled();
    expect(store.getSelectorTraceSummary()[0]).toEqual(
      expect.objectContaining({
        executionCount: 1,
        recomputationCount: 1,
        cache: { requestCount: 1, hitCount: 0, missCount: 1, hitRatio: 0 },
      })
    );
  });

  it('starts interval aggregation when summaries are disabled but tracing is enabled', () => {
    vi.useFakeTimers();
    const store = new Store(
      { counter: counterReducer },
      undefined,
      { traceSelectors: { traceExecution: true } }
    );
    const dispose = store.init();

    expect(store.getSelectorTraceSummary()).toEqual([]);
    expect(Object.isFrozen(store.getSelectorTraceSummary())).toBe(true);
    expect((store as any).selectorTraceSummaryCollector).toBeDefined();
    expect((store as any).selectorTraceSummaryInterval).toBeDefined();
    dispose();
  });

  it('defers all selector categories into one non-empty period aggregate', () => {
    vi.useFakeTimers();
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const store = new Store(undefined, undefined, {
      traceSelectors: {
        traceExecution: true,
        traceCache: true,
        traceInvalidation: true,
        traceArguments: true,
        traceResults: true,
        summaryIntervalMs: 25,
      },
    });
    const selectorFunc = (state: { count: number }, _factor: number) => state.count;
    const reporter = store.getSelectorTraceReporter()!;

    store.init();
    reporter({
      selectorFunc,
      executionDurationMs: 2,
      recomputationCount: 1,
      invalidationReason: 'first-execution',
      argumentsChanged: false,
      resultOutcome: 'initial',
    });
    reporter({
      selectorFunc,
      observableCacheRequestCount: 1,
      observableCacheCachedCount: 1,
      outputCacheStatus: 'miss',
      outputCacheRequestCount: 1,
      outputCacheHitCount: 0,
      outputCacheMissCount: 1,
    });

    expect(consoleInfo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(25);
    expect(consoleInfo).toHaveBeenCalledTimes(1);
    expect(consoleInfo.mock.calls[0][0]).toContain('[themis] selector trace summary');
    expect(consoleInfo.mock.calls[0].at(-1)).toEqual(expect.objectContaining({
      selectors: [expect.objectContaining({
        executionCount: 1,
        cache: expect.objectContaining({ requestCount: 1, missCount: 1 }),
      })],
    }));
    store.dispose();
  });

  it('exposes equivalent summary behavior on Svelte, React, and Streaming stores', () => {
    const svelteStore = createSummaryStore();
    const svelteSelector = svelteStore.createSelector(selectorFunc);
    const disposeSvelte = svelteStore.init();
    const unsubscribe = svelteSelector().subscribe(() => undefined);
    unsubscribe();
    expect(svelteStore.getSelectorTraceSummary()[0].executionCount).toBe(1);
    expect(svelteStore.getSelectorTraceSummary()[0].cache.missCount).toBe(1);
    disposeSvelte();

    const reactStore = new ReactStore(
      { counter: counterReducer },
      undefined,
      { traceSelectors: { summaryEnabled: true } }
    );
    const reactSelector = reactStore.createSelector(selectorFunc);
    const disposeReact = reactStore.init();
    expect(reactSelector().value).toBe(0);
    expect(reactStore.getSelectorTraceSummary()[0].executionCount).toBe(1);
    expect(reactStore.getSelectorTraceSummary()[0].cache.missCount).toBe(1);
    disposeReact();

    const streamingStore = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { traceSelectors: { summaryEnabled: true } }
    );
    const streamingSelector = streamingStore.createSelector(selectorFunc);
    const disposeStreaming = streamingStore.init();
    const subscription = streamingSelector().observe(() => undefined);
    subscription.unsubscribe();
    expect(streamingStore.getSelectorTraceSummary()[0].executionCount).toBe(1);
    expect(streamingStore.getSelectorTraceSummary()[0].cache.missCount).toBe(1);
    disposeStreaming();
  });
});