import Kefir from 'kefir';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingStore } from './streaming-store';
import { sagaManager } from './slices/saga-manager/sagas/manager';

const mockSagaTask = { cancel: vi.fn() };
const mockSagaMiddleware = Object.assign(
  vi.fn(() => (next: any) => (action: any) => next(action)),
  { run: vi.fn(() => mockSagaTask) }
) as any;

vi.mock('redux-saga', () => ({
  default: vi.fn(() => mockSagaMiddleware),
}));

vi.mock('./slices/saga-manager/sagas/manager', () => ({
  sagaManager: vi.fn(function* () {}),
}));

const counterReducer = Object.assign(
  (state = { count: 0 }, action: any) => {
    return action.type === 'counter/set' ? { count: action.payload } : state;
  },
  { initialState: { count: 0 } }
);

describe('StreamingStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns streaming selectors bound to Redux store updates', () => {
    const store = new StreamingStore({ counter: counterReducer });
    const values: number[] = [];

    store.init();
    const selectCount = store.createSelector((state) => state.counter.count);
    const subscription = selectCount().observe((value) => values.push(value));
    store.dispatch({ type: 'counter/set', payload: 2 });
    expect(values).toEqual([0]);
    vi.advanceTimersByTime(0);
    subscription.unsubscribe();

    expect(selectCount()).toBeInstanceOf(Kefir.Observable);
    expect(values).toEqual([0, 2]);
    expect(Object.keys((store as any).storeContext).sort()).toEqual(['store']);
    expect(mockSagaMiddleware.run).toHaveBeenCalledTimes(1);
    const [startedSaga, reduxStore] = mockSagaMiddleware.run.mock.calls[0];
    expect(startedSaga).toBe(sagaManager);
    expect(reduxStore).toEqual(expect.objectContaining({
      getState: expect.any(Function),
      subscribe: expect.any(Function),
    }));
  });

  it('traces Store-created streaming selector evaluations', () => {
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const store = new StreamingStore(
        { counter: counterReducer },
        undefined,
        { traceSelectors: true }
      );

      store.init();
      const selectCount = store.createSelector((state) => state.counter.count);
      const subscription = selectCount().observe(() => {});
      subscription.unsubscribe();
      vi.advanceTimersByTime(1000);
      const aggregate = consoleInfoSpy.mock.calls
        .filter(([prefix]) => typeof prefix === 'string' && prefix.includes('[themis] selector trace summary'))
        .at(-1)?.at(-1) as any;
      expect(aggregate.selectors[0]).toEqual(expect.objectContaining({
        recomputationCount: 1,
        duration: expect.objectContaining({ count: 1 }),
        cache: expect.objectContaining({ requestCount: 1, missCount: 1 }),
        selectorSource: expect.stringContaining('state.counter.count'),
      }));
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });

  it('traces streaming selector observable cache request and cached counts', () => {
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const store = new StreamingStore(
        { counter: counterReducer },
        undefined,
        { traceSelectors: true }
      );

      store.init();
      const selectCount = store.createSelector((state) => state.counter.count);
      const first = selectCount();
      const second = selectCount();
      const third = selectCount();

      expect(second).toBe(first);
      expect(third).toBe(first);
      vi.advanceTimersByTime(1000);

      const cacheTraces = consoleInfoSpy.mock.calls
        .filter(([prefix]) => typeof prefix === 'string' && prefix.includes('[themis] selector trace summary'))
        .at(-1)?.at(-1) as any;
      expect(cacheTraces.selectors[0].cache).toEqual({
        requestCount: 3,
        hitCount: 2,
        missCount: 1,
        hitRatio: 2 / 3,
      });
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });

  it('isolates observable selector cache trace counts between StreamingStore instances', () => {
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const storeA = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { traceSelectors: true }
    );
    const storeB = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { traceSelectors: true }
    );
    const selectCount = storeA.createSelector((state) => state.counter.count);

    storeA.init();
    storeB.init();
    selectCount();
    selectCount.withStore(storeB)();
    vi.advanceTimersByTime(1000);

    const cacheTraces = consoleInfoSpy.mock.calls
      .filter(([prefix]) => typeof prefix === 'string' && prefix.includes('[themis] selector trace summary'))
      .map((call) => call.at(-1) as any);
    expect(cacheTraces).toHaveLength(2);
    expect(cacheTraces.map((aggregate) => aggregate.selectors[0].cache)).toEqual([
      { requestCount: 1, hitCount: 0, missCount: 1, hitRatio: 0 },
      { requestCount: 1, hitCount: 0, missCount: 1, hitRatio: 0 },
    ]);
    consoleInfoSpy.mockRestore();
  });

  it('throttles selector emissions with the configured Store option', () => {
    const store = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { throttledSelectorFrequency: 10 }
    );
    const values: number[] = [];

    store.init();
    const selectCount = store.createSelector((state) => state.counter.count);
    const subscription = selectCount().observe((value) => values.push(value));
    store.dispatch({ type: 'counter/set', payload: 2 });
    vi.advanceTimersByTime(0);
    store.dispatch({ type: 'counter/set', payload: 3 });
    vi.advanceTimersByTime(99);
    expect(values).toEqual([0, 2]);

    vi.advanceTimersByTime(1);
    subscription.unsubscribe();

    expect((store as any).storeOptions).toEqual({
      throttledSelectorFrequency: 10,
      sagaMonitor: false,
      logReduxActions: false,
      traceSelectors: expect.objectContaining({
        traceExecution: false,
        traceCache: false,
        traceCadence: false,
      }),
    });
    expect(values).toEqual([0, 2, 3]);
  });

  it('shares requested cadence ticks across stream selectors and stays idle between updates', () => {
    const store = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { throttledSelectorFrequency: 10 }
    );
    const countValues: number[] = [];
    const doubleValues: number[] = [];

    store.init();
    const selectCount = store.createSelector((state) => state.counter.count);
    const selectDoubleCount = store.createSelector((state) => state.counter.count * 2);
    const countSubscription = selectCount().observe((value) => countValues.push(value));
    const doubleSubscription = selectDoubleCount().observe((value) => doubleValues.push(value));
    store.dispatch({ type: 'counter/set', payload: 1 });
    store.dispatch({ type: 'counter/set', payload: 2 });

    expect(vi.getTimerCount()).toBe(1);
    expect(countValues).toEqual([0]);
    expect(doubleValues).toEqual([0]);

    vi.advanceTimersByTime(0);
    expect(countValues).toEqual([0, 2]);
    expect(doubleValues).toEqual([0, 4]);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(500);
    expect(countValues).toEqual([0, 2]);
    expect(doubleValues).toEqual([0, 4]);
    expect(vi.getTimerCount()).toBe(0);

    store.dispatch({ type: 'counter/set', payload: 3 });
    expect(vi.getTimerCount()).toBe(1);
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    countSubscription.unsubscribe();
    doubleSubscription.unsubscribe();

    expect(countValues).toEqual([0, 2]);
    expect(doubleValues).toEqual([0, 4]);
  });

  it('throws when a stream selector output is requested before initialization', () => {
    const store = new StreamingStore({ counter: counterReducer });

    const selectCount = store.createSelector((state) => state.counter.count);
    expect(() => selectCount()).toThrow(
      'Cannot access StoreRuntime.getStoreStateStream() before Store.init() has been called.'
    );
  });

  it('clears runtime state stream on dispose', () => {
    const store = new StreamingStore({ counter: counterReducer });
    const selectCount = store.createSelector((state) => state.counter.count);

    store.init();
    store.dispose();

    expect(() => selectCount()).toThrow(
      'Cannot access StoreRuntime.getStoreStateStream() before Store.init() has been called.'
    );
  });

  it('creates a fresh streaming selector output after dispose and re-init', () => {
    const store = new StreamingStore({ counter: counterReducer });
    const selectCount = store.createSelector((state) => state.counter.count);

    store.init();
    const previousOutput = selectCount();
    store.dispose();

    expect(() => selectCount()).toThrow(
      'Cannot access StoreRuntime.getStoreStateStream() before Store.init() has been called.'
    );

    store.init({ counter: { count: 5 } });
    const freshOutput = selectCount();
    const values: number[] = [];
    const subscription = freshOutput.observe((value) => values.push(value));

    expect(freshOutput).not.toBe(previousOutput);
    expect(values).toEqual([5]);

    store.dispatch({ type: 'counter/set', payload: 6 });
    vi.advanceTimersByTime(0);
    subscription.unsubscribe();

    expect(values).toEqual([5, 6]);
  });
});