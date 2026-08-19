import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from './react-store';
import { Store } from './svelte-store';
import { StreamingStore } from './streaming-store';
import type { StoreLoggerFactory, StoreOptions } from './types';

vi.mock('./utils/runtime-svelte/utils', () => ({
  getStoreContext: vi.fn(() => undefined),
  getDispatch: vi.fn(),
}));

const counterReducer = Object.assign(
  (state = { count: 0 }) => state,
  { initialState: { count: 0 } }
);

const createStores = (options: StoreOptions) => [
  new Store({ counter: counterReducer }, undefined, options),
  new ReactStore({ counter: counterReducer }, undefined, options),
  new StreamingStore({ counter: counterReducer }, undefined, options),
];

describe('selector trace streams', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes configured detail and cadence events without exposing disabled categories', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);

    for (const store of createStores({
      traceSelectors: { traceExecution: true, traceCadence: true },
      loggerFactory: (() => undefined) satisfies StoreLoggerFactory,
    })) {
      const details: unknown[] = [];
      const cadence: unknown[] = [];
      const detailSubscription = store.traceStreams.selectorDetail.observe((event) => {
        details.push(event);
      });
      const cadenceSubscription = store.traceStreams.selectorCadence.observe((event) => {
        cadence.push(event);
      });
      const dispose = store.init();
      let selectorCleanup: () => void = () => {};

      if (store instanceof Store) {
        const selector = store.createSelector((state) => state.counter.count);
        selectorCleanup = selector().subscribe(() => undefined);
      } else if (store instanceof ReactStore) {
        const selector = store.createSelector((state) => state.counter.count);
        selectorCleanup = selector().subscribe(() => undefined);
      } else {
        const selector = store.createSelector((state) => state.counter.count);
        const subscription = selector().observe(() => undefined);
        selectorCleanup = () => subscription.unsubscribe();
      }
      store.dispatch({ type: 'trace/tick' });
      vi.advanceTimersByTime(0);

      expect(details).toEqual([
        expect.objectContaining({ kind: 'selector', accessedPathCount: 2 }),
      ]);
      expect(details[0]).not.toHaveProperty('argumentsChanged');
      expect(cadence).toEqual([
        { type: 'subscribe', listenerCount: 1 },
        { type: 'tick', timestamp: 0, listenerCount: 1 },
      ]);

      dispose();
      selectorCleanup();
      detailSubscription.unsubscribe();
      cadenceSubscription.unsubscribe();
    }
  });

  it('publishes periodic summaries only when summaryEnabled is set', () => {
    vi.useFakeTimers();

    for (const store of createStores({
      traceSelectors: { summaryEnabled: true, summaryIntervalMs: 10 },
      loggerFactory: (() => undefined) satisfies StoreLoggerFactory,
    })) {
      const summaries: unknown[] = [];
      const subscription = store.traceStreams.selectorSummary.observe((summary) => {
        summaries.push(summary);
      });
      const dispose = store.init();

      if (store instanceof Store) {
        const selector = store.createSelector((state) => state.counter.count);
        selector().subscribe(() => undefined)();
      } else if (store instanceof ReactStore) {
        const selector = store.createSelector((state) => state.counter.count);
        selector();
      } else {
        const selector = store.createSelector((state) => state.counter.count);
        const selectorSubscription = selector().observe(() => undefined);
        selectorSubscription.unsubscribe();
      }
      vi.advanceTimersByTime(10);

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toEqual([
        expect.objectContaining({
          selectorSource: expect.any(String),
          executionCount: 1,
          recomputationCount: 1,
        }),
      ]);

      dispose();
      subscription.unsubscribe();
    }
  });

  it('stops and recreates the summary interval across init and disposal', () => {
    vi.useFakeTimers();
    const store = new Store(
      { counter: counterReducer },
      undefined,
      { traceSelectors: { summaryEnabled: true, summaryIntervalMs: 25 } }
    );
    const summaries: unknown[] = [];
    const subscription = store.traceStreams.selectorSummary.observe((summary) => {
      summaries.push(summary);
    });

    const dispose = store.init();
    store.init();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(25);
    expect(summaries).toHaveLength(1);

    dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(summaries).toHaveLength(1);

    const disposeAgain = store.init();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(25);
    expect(summaries).toHaveLength(2);
    disposeAgain();
    subscription.unsubscribe();
  });
});