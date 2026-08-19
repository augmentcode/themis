import { type ReadonlySignal } from '@preact/signals-react';
import { describe, it, expect, vi, beforeEach, afterEach, expectTypeOf } from 'vitest';
import { ReactStore } from './react-store';
import { sagaManager } from './slices/saga-manager/sagas/manager';

const mocks = vi.hoisted(() => ({
  useSignals: vi.fn(),
}));

vi.mock('@preact/signals-react/runtime', () => ({
  useSignals: mocks.useSignals,
}));

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

describe('ReactStore', () => {
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

  it('returns signal selectors bound to Redux store updates', () => {
    const store = new ReactStore({ counter: counterReducer });
    const selectCount = store.createSelector((state) => state.counter.count);
    const values: number[] = [];

    store.init();
    const selected = selectCount();
    expectTypeOf(selected).toEqualTypeOf<ReadonlySignal<number>>();
    const unsubscribe = selected.subscribe((value) => values.push(value));
    store.dispatch({ type: 'counter/set', payload: 2 });
    expect(values).toEqual([0]);
    vi.advanceTimersByTime(0);
    unsubscribe();

    expect(selected.value).toBe(2);
    expect(values).toEqual([0, 2]);
  });

  it('traces Store-created signal selector evaluations', () => {
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const store = new ReactStore(
        { counter: counterReducer },
        undefined,
        { traceSelectors: { summaryEnabled: true } }
      );
      const selectCount = store.createSelector((state) => state.counter.count);

      store.init();
      const selected = selectCount();

      expect(selected.value).toBe(0);
      vi.advanceTimersByTime(1000);
      const aggregate = consoleInfoSpy.mock.calls
        .filter(([prefix]) => typeof prefix === 'string' && prefix.includes('[themis] selectors fired:'))
        .at(-1)?.at(-1) as any;
      expect(aggregate.selectors).toEqual([
        expect.objectContaining({
          recomputationCount: 1,
          duration: expect.objectContaining({ count: 1 }),
          cache: expect.objectContaining({ requestCount: 1, missCount: 1 }),
          selectorSource: expect.stringContaining('state.counter.count'),
        }),
      ]);
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });

  it('traces Store-created signal selector output cache request and cached counts', () => {
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const store = new ReactStore(
        { counter: counterReducer },
        undefined,
        { traceSelectors: { summaryEnabled: true } }
      );
      const selectCount = store.createSelector((state) => state.counter.count);

      store.init();
      const first = selectCount();
      const second = selectCount();
      const third = selectCount();

      expect(second).toBe(first);
      expect(third).toBe(first);
      vi.advanceTimersByTime(1000);

      const cacheTraces = consoleInfoSpy.mock.calls
        .filter(([prefix]) => typeof prefix === 'string' && prefix.includes('[themis] selectors fired:'))
        .at(-1)?.at(-1) as any;
      expect(cacheTraces.selectors[0]).toEqual(expect.objectContaining({
        cache: { requestCount: 3, hitCount: 2, missCount: 1, hitRatio: 2 / 3 },
      }));
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });

  it('isolates signal selector cache trace counts between ReactStore instances', () => {
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const storeA = new ReactStore({ counter: counterReducer }, undefined, { traceSelectors: { summaryEnabled: true } });
    const storeB = new ReactStore({ counter: counterReducer }, undefined, { traceSelectors: { summaryEnabled: true } });
    const selectCount = storeA.createSelector((state) => state.counter.count);

    storeA.init();
    storeB.init();
    selectCount();
    selectCount.withStore(storeB)();
    vi.advanceTimersByTime(1000);

    const cacheTraces = consoleInfoSpy.mock.calls
      .filter(([prefix]) => typeof prefix === 'string' && prefix.includes('[themis] selectors fired:'))
      .map((call) => call.at(-1) as any);
    expect(cacheTraces).toHaveLength(2);
    expect(cacheTraces.map((aggregate) => aggregate.selectors[0].cache)).toEqual([
      { requestCount: 1, hitCount: 0, missCount: 1, hitRatio: 0 },
      { requestCount: 1, hitCount: 0, missCount: 1, hitRatio: 0 },
    ]);
    consoleInfoSpy.mockRestore();
  });

  it('starts the saga manager with the Redux store', () => {
    const store = new ReactStore({ counter: counterReducer });

    store.init();

    expect(mockSagaMiddleware.run).toHaveBeenCalledTimes(1);
    const [startedSaga, reduxStore] = mockSagaMiddleware.run.mock.calls[0];
    expect(startedSaga).toBe(sagaManager);
    expect(reduxStore).toEqual(expect.objectContaining({
      getState: expect.any(Function),
      subscribe: expect.any(Function),
    }));
  });

  it('exposes .useValue() on selectors as a React signal value read', () => {
    const store = new ReactStore({ counter: counterReducer });
    const selectCount = store.createSelector((state) => state.counter.count);

    store.init();

    expect(selectCount.useValue()).toBe(0);
    expect(mocks.useSignals).toHaveBeenCalledTimes(1);
  });

  it('shares one store-scoped cadence source across active signal selectors and disposes scheduled work', () => {
    const store = new ReactStore(
      { counter: counterReducer },
      undefined,
      { throttledSelectorFrequency: 10 }
    );
    const selectCount = store.createSelector((state) => state.counter.count);
    const selectDoubleCount = store.createSelector((state) => state.counter.count * 2);
    const countValues: number[] = [];
    const doubleValues: number[] = [];

    store.init();
    const countSignal = selectCount();
    const doubleSignal = selectDoubleCount();
    const unsubscribeCount = countSignal.subscribe((value) => countValues.push(value));
    const unsubscribeDouble = doubleSignal.subscribe((value) => doubleValues.push(value));

    expect(vi.getTimerCount()).toBe(0);
    expect(countValues).toEqual([0]);
    expect(doubleValues).toEqual([0]);

    store.dispatch({ type: 'counter/set', payload: 1 });
    store.dispatch({ type: 'counter/set', payload: 2 });

    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(0);
    expect(countValues).toEqual([0, 2]);
    expect(doubleValues).toEqual([0, 4]);
    expect(vi.getTimerCount()).toBe(0);

    store.dispatch({ type: 'counter/set', payload: 3 });
    store.dispatch({ type: 'counter/set', payload: 4 });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(99);
    expect(countValues).toEqual([0, 2]);
    expect(doubleValues).toEqual([0, 4]);
    vi.advanceTimersByTime(1);
    expect(countValues).toEqual([0, 2, 4]);
    expect(doubleValues).toEqual([0, 4, 8]);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(500);
    expect(vi.getTimerCount()).toBe(0);

    store.dispatch({ type: 'counter/set', payload: 5 });
    expect(vi.getTimerCount()).toBe(1);
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    unsubscribeCount();
    unsubscribeDouble();

    expect(countValues).toEqual([0, 2, 4]);
    expect(doubleValues).toEqual([0, 4, 8]);
  });

  it('throws when signal state is read before initialization', () => {
    const store = new ReactStore({ counter: counterReducer });
    const selectCount = store.createSelector((state) => state.counter.count);

    expect(() => selectCount()).toThrow(
      'Cannot access StoreRuntime.getStoreStateStream() before Store.init() has been called.'
    );
  });

  it('clears runtime state stream on dispose', () => {
    const store = new ReactStore({ counter: counterReducer });
    const selectCount = store.createSelector((state) => state.counter.count);

    store.init();
    store.dispose();

    expect(() => selectCount()).toThrow(
      'Cannot access StoreRuntime.getStoreStateStream() before Store.init() has been called.'
    );
  });

  it('creates a fresh signal selector output after dispose and re-init', () => {
    const store = new ReactStore({ counter: counterReducer });
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
    const unsubscribe = freshOutput.subscribe((value) => values.push(value));

    expect(freshOutput).not.toBe(previousOutput);
    expect(freshOutput.value).toBe(5);
    expect(values).toEqual([5]);

    store.dispatch({ type: 'counter/set', payload: 6 });
    vi.advanceTimersByTime(0);
    unsubscribe();

    expect(freshOutput.value).toBe(6);
    expect(values).toEqual([5, 6]);
  });
});