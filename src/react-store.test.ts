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
      const store = new ReactStore({ counter: counterReducer });
      const selectCount = store.createSelector((state) => state.counter.count);

      store.traceSelectors();
      store.init();
      const selected = selectCount();

      expect(selected.value).toBe(0);
      const cacheTraces = consoleInfoSpy.mock.calls
        .map((call) => call[1] as any)
        .filter((payload) => payload && 'observableCacheRequestCount' in payload);
      expect(cacheTraces).toEqual([
        expect.objectContaining({
          observableCacheRequestCount: expect.any(Number),
          observableCacheCachedCount: expect.any(Number),
          selectorSource: expect.stringContaining('state.counter.count'),
        }),
      ]);
      const accessTraces = consoleInfoSpy.mock.calls
        .map((call) => call[1] as any)
        .filter((payload) => payload && 'accessedPathCount' in payload);
      expect(accessTraces).toEqual([
        expect.objectContaining({
          accessedPathCount: 2,
          accessedPaths: ['counter', 'counter.count'],
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
      const store = new ReactStore({ counter: counterReducer });
      const selectCount = store.createSelector((state) => state.counter.count);

      store.traceSelectors();
      store.init();
      const first = selectCount();
      const second = selectCount();
      const third = selectCount();

      expect(second).toBe(first);
      expect(third).toBe(first);

      const cacheTraces = consoleInfoSpy.mock.calls
        .map((call) => call[1] as any)
        .filter((payload) => payload && 'observableCacheRequestCount' in payload);
      expect(cacheTraces).toHaveLength(3);
      expect(cacheTraces[1].observableCacheRequestCount).toBe(
        cacheTraces[0].observableCacheRequestCount + 1
      );
      expect(cacheTraces[2].observableCacheRequestCount).toBe(
        cacheTraces[0].observableCacheRequestCount + 2
      );
      expect(cacheTraces[1].observableCacheCachedCount).toBe(cacheTraces[0].observableCacheCachedCount);
      expect(cacheTraces[2].observableCacheCachedCount).toBe(cacheTraces[0].observableCacheCachedCount);
    } finally {
      consoleInfoSpy.mockRestore();
    }
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
});