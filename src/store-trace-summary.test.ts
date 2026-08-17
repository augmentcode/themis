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

  it('reports periodically after init and stops the interval on disposal', () => {
    vi.useFakeTimers();
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const store = createSummaryStore();
    expect(vi.getTimerCount()).toBe(0);
    const dispose = store.init();
    expect(vi.getTimerCount()).toBe(1);
    store.init();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(25);
    expect(consoleInfo).toHaveBeenCalledWith('[themis] selector trace summary', []);
    const callsAfterFirstInterval = consoleInfo.mock.calls.length;

    dispose();
    vi.advanceTimersByTime(100);
    expect(consoleInfo).toHaveBeenCalledTimes(callsAfterFirstInterval);
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

  it('allocates neither a collector nor a timer when summaries are disabled', () => {
    vi.useFakeTimers();
    const store = new Store(
      { counter: counterReducer },
      undefined,
      { traceSelectors: { traceExecution: true } }
    );
    const dispose = store.init();

    expect(store.getSelectorTraceSummary()).toEqual([]);
    expect(Object.isFrozen(store.getSelectorTraceSummary())).toBe(true);
    expect((store as any).selectorTraceSummaryCollector).toBeUndefined();
    expect((store as any).selectorTraceSummaryInterval).toBeUndefined();
    dispose();
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