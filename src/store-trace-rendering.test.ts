import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as selectorCore from './utils/selector-core/create-cached-selector';
import { getStoreContext } from './utils/runtime-svelte/utils';

const { renderAccessedPathsSpy } = vi.hoisted(() => ({
  renderAccessedPathsSpy: vi.fn(),
}));

vi.mock('./utils/selector-core/create-cached-selector', async (importOriginal) => {
  const actual = await importOriginal<typeof selectorCore>();
  renderAccessedPathsSpy.mockImplementation(actual.renderAccessedPaths);

  return {
    ...actual,
    renderAccessedPaths: renderAccessedPathsSpy,
  };
});

vi.mock('./utils/runtime-svelte/utils', () => ({
  getStoreContext: vi.fn(() => undefined),
  getDispatch: vi.fn(),
}));

import { Store } from './svelte-store';
import { createCachedSelector } from './utils/selector-core/create-cached-selector';

const initialState = {
  count: 0,
  label: 'zero',
  user: { name: 'Ada' },
};
const reducer = Object.assign((state = initialState) => state, { initialState });

describe('Store selector trace rendering', () => {
  beforeEach(() => {
    renderAccessedPathsSpy.mockClear();
    vi.mocked(getStoreContext).mockReturnValue(undefined);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes raw accessed paths to trace reporters before any rendering', () => {
    const traceReporter = vi.fn();
    const selector = createCachedSelector<{ trace: { count: number } }, [], number>(
      (state) => state.trace.count,
      { traceReporter }
    );

    selector({ trace: { count: 1 } });

    expect(traceReporter).toHaveBeenCalledTimes(1);
    const trace = traceReporter.mock.calls[0][0];
    expect(trace.accessedPaths).toBeInstanceOf(Set);
    expect(trace.parsedPaths).toBeInstanceOf(Map);
    expect(Array.isArray(trace.accessedPaths)).toBe(false);
    expect(Array.from(trace.accessedPaths)).toEqual(['["trace"]', '["trace","count"]']);
  });

  it('activates legacy tracing and emits one aggregate after the interval', () => {
    vi.useFakeTimers();
    const store = new Store({ trace: reducer });
    const explicitlyDisabledStore = new Store(
      { trace: reducer },
      undefined,
      { traceSelectors: false }
    );
    const selectCount = store.createSelector((state) => state.trace.count);
    const selectExplicitCount = explicitlyDisabledStore.createSelector((state) => state.trace.count);

    store.traceSelectors();
    explicitlyDisabledStore.traceSelectors();
    store.init();
    explicitlyDisabledStore.init();
    selectCount().subscribe(() => {})();
    selectExplicitCount().subscribe(() => {})();

    expect(store.getSelectorTraceReporter()).toEqual(expect.any(Function));
    expect(explicitlyDisabledStore.getSelectorTraceReporter()).toEqual(expect.any(Function));
    expect(renderAccessedPathsSpy).not.toHaveBeenCalled();
    const aggregateCalls = () => vi.mocked(console.info).mock.calls.filter(([prefix]) =>
      typeof prefix === 'string' && prefix.includes('[themis] selector trace summary')
    );
    expect(aggregateCalls()).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(aggregateCalls()).toHaveLength(2);
    expect(aggregateCalls()[0].at(-1)).toEqual(expect.objectContaining({
      selectors: [expect.objectContaining({
        selectorSource: expect.stringContaining('state.trace.count'),
      })],
    }));
  });

  it('aggregates every enabled selector execution without rendering paths or values', () => {
    vi.useFakeTimers();
    const store = new Store(
      { trace: reducer },
      undefined,
      { traceSelectors: true }
    );
    const selectCount = store.createSelector((state) => state.trace.count);
    const selectLabel = store.createSelector((state) => state.trace.label);
    const selectTrace = store.createSelector((state) => state.trace);
    const selectUserName = store.createSelector((state) => state.trace.user.name);

    store.init();

    const accessedPathTraces = () =>
      vi.mocked(console.info).mock.calls.filter(([, payload]) => {
        return payload && typeof payload === 'object' && 'accessedPathCount' in payload;
      });

    selectCount().subscribe(() => {})();
    expect(renderAccessedPathsSpy).not.toHaveBeenCalled();
    expect(accessedPathTraces()).toHaveLength(0);

    selectLabel().subscribe(() => {})();
    selectTrace().subscribe(() => {})();
    expect(renderAccessedPathsSpy).not.toHaveBeenCalled();
    expect(accessedPathTraces()).toHaveLength(0);

    selectUserName().subscribe(() => {})();
    expect(renderAccessedPathsSpy).not.toHaveBeenCalled();
    expect(accessedPathTraces()).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    const aggregateCalls = () => vi.mocked(console.info).mock.calls.filter(([prefix]) =>
      typeof prefix === 'string' && prefix.includes('[themis] selector trace summary')
    );
    expect(aggregateCalls()).toHaveLength(1);
    expect(aggregateCalls()[0].at(-1)).toEqual(expect.objectContaining({
      selectors: expect.arrayContaining([
        expect.objectContaining({ selectorSource: expect.stringContaining('state.trace.count') }),
        expect.objectContaining({ selectorSource: expect.stringContaining('state.trace.label') }),
      ]),
    }));
  });

  it('filters aggregate execution rows by inclusive period duration and recomputation thresholds', () => {
    vi.useFakeTimers();
    const store = new Store(undefined, undefined, {
      traceSelectors: {
        traceExecution: true,
        minDurationMs: 2,
        minRecomputationCount: 2,
      },
    });
    const reporter = store.getSelectorTraceReporter()!;
    const selectorFunc = (state: { count: number }) => state.count;
    const traceMetadata = {
      selectorFunc,
      accessedPaths: new Set(['["count"]']),
      parsedPaths: new Map([['["count"]', ['count']]]),
    };

    reporter({ ...traceMetadata, executionDurationMs: 1, recomputationCount: 2 });
    reporter({ ...traceMetadata, executionDurationMs: 1, recomputationCount: 1 });
    store.init();
    vi.advanceTimersByTime(1000);
    expect(console.info).not.toHaveBeenCalled();

    reporter({ ...traceMetadata, executionDurationMs: 2, recomputationCount: 2 });
    reporter({ ...traceMetadata, executionDurationMs: 2, recomputationCount: 2 });
    vi.advanceTimersByTime(1000);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.info.mock.calls[0].at(-1)).toEqual(expect.objectContaining({
      selectors: [expect.objectContaining({
        recomputationCount: 2,
        duration: expect.objectContaining({ maximumMs: 2 }),
      })],
    }));
  });

  it('filters aggregate cache rows by inclusive miss threshold and bolds only miss labels', () => {
    vi.useFakeTimers();
    const store = new Store(undefined, undefined, {
      traceSelectors: { traceCache: true, minCacheMissCount: 2 },
    });
    const reporter = store.getSelectorTraceReporter()!;
    const selectorFunc = (state: { count: number }) => state.count;
    const cacheTrace = (outputCacheStatus: 'hit' | 'miss', outputCacheMissCount: number) => ({
      selectorFunc,
      observableCacheRequestCount: 1,
      observableCacheCachedCount: 1,
      outputCacheStatus,
      outputCacheRequestCount: 2,
      outputCacheHitCount: 1,
      outputCacheMissCount,
    });

    reporter(cacheTrace('miss', 1));
    store.init();
    vi.advanceTimersByTime(1000);
    const aggregateCalls = () => vi.mocked(console.info).mock.calls.filter(([prefix]) =>
      typeof prefix === 'string' && prefix.includes('[themis] selector trace summary')
    );
    expect(aggregateCalls()).toHaveLength(0);

    reporter(cacheTrace('miss', 2));
    reporter(cacheTrace('miss', 2));
    vi.advanceTimersByTime(1000);
    expect(aggregateCalls()).toHaveLength(1);
    expect(aggregateCalls()[0][0]).toContain('%c');
    expect(aggregateCalls()[0][1]).toBe('font-weight: bold');

    reporter(cacheTrace('hit', 2));
    vi.advanceTimersByTime(1000);
    expect(aggregateCalls()).toHaveLength(1);
  });

  it('bolds only selector labels with period cache misses', () => {
    vi.useFakeTimers();
    const store = new Store(undefined, undefined, {
      traceSelectors: { traceCache: true },
    });
    const reporter = store.getSelectorTraceReporter()!;
    const missSelector = (state: { count: number }) => state.count;
    const hitSelector = (state: { count: number }) => state.count + 1;
    const cacheTrace = (
      selectorFunc: typeof missSelector,
      outputCacheStatus: 'hit' | 'miss'
    ) => ({
      selectorFunc,
      observableCacheRequestCount: 1,
      observableCacheCachedCount: outputCacheStatus === 'miss' ? 1 : 0,
      outputCacheStatus,
      outputCacheRequestCount: 1,
      outputCacheHitCount: outputCacheStatus === 'hit' ? 1 : 0,
      outputCacheMissCount: outputCacheStatus === 'miss' ? 1 : 0,
    });

    reporter(cacheTrace(missSelector, 'miss'));
    reporter(cacheTrace(hitSelector, 'hit'));
    store.init();
    vi.advanceTimersByTime(1000);

    const call = vi.mocked(console.info).mock.calls[0];
    expect(call[0]).toContain('%c');
    expect(call[1]).toBe('font-weight: bold');
    expect(call[2]).toBe('');
    expect(call[3]).toBe('');
    expect(call[4]).toBe('');
    expect(call.at(-1)).toEqual(expect.objectContaining({
      selectors: [
        expect.objectContaining({ selectorSource: expect.stringContaining('state.count') }),
        expect.objectContaining({ selectorSource: expect.stringContaining('state.count + 1') }),
      ],
    }));
  });

  it('keeps configured flat categories unchanged when the legacy method is called', () => {
    vi.useFakeTimers();
    const store = new Store(
      { trace: reducer },
      undefined,
      { traceSelectors: { traceInvalidation: true } }
    );
    const selectCount = store.createSelector((state) => state.trace.count);

    store.traceSelectors();
    store.init();
    selectCount().subscribe(() => {})();

    vi.advanceTimersByTime(1000);
    const payloads = vi.mocked(console.info).mock.calls.map((call) => call.at(-1));
    expect(payloads).toEqual([
      expect.objectContaining({
        selectors: [expect.objectContaining({
          invalidationReasons: expect.objectContaining({ 'first-execution': 1 }),
        })],
      }),
    ]);
    expect(renderAccessedPathsSpy).not.toHaveBeenCalled();
  });

  it('reports execution timing and recomputation count only when the selector executes', () => {
    const traceReporter = vi.fn();
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(12.5)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(24);
    const selector = createCachedSelector<{ count: number }, [], number>(
      (state) => state.count,
      { traceReporter }
    );

    selector({ count: 1 });
    selector({ count: 1 });
    selector({ count: 2 });

    expect(now).toHaveBeenCalledTimes(4);
    expect(traceReporter.mock.calls.map(([trace]) => trace)).toEqual([
      expect.objectContaining({ executionDurationMs: 2.5, recomputationCount: 1 }),
      expect.objectContaining({ executionDurationMs: 4, recomputationCount: 2 }),
    ]);
  });
});