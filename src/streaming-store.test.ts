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
    const selectCount = store.createSelector((state) => state.counter.count);
    const values: number[] = [];

    store.init();
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
      const store = new StreamingStore({ counter: counterReducer });
      const selectCount = store.createSelector((state) => state.counter.count);

      store.traceSelectors();
      store.init();
      const subscription = selectCount().observe(() => {});
      subscription.unsubscribe();

      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[themis] selector trace',
        expect.objectContaining({
          accessedPathCount: 2,
          accessedPaths: ['counter', 'counter.count'],
          selectorSource: expect.stringContaining('state.counter.count'),
        })
      );
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });

  it('throttles selector emissions with the configured Store option', () => {
    const store = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { throttledSelectorFrequency: 10 }
    );
    const selectCount = store.createSelector((state) => state.counter.count);
    const values: number[] = [];

    store.init();
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
      traceSelectors: false,
    });
    expect(values).toEqual([0, 2, 3]);
  });

  it('shares one store-scoped flush manager across stream selectors and disposes scheduled work', () => {
    const store = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { throttledSelectorFrequency: 10 }
    );
    const selectCount = store.createSelector((state) => state.counter.count);
    const selectDoubleCount = store.createSelector((state) => state.counter.count * 2);
    const countValues: number[] = [];
    const doubleValues: number[] = [];

    store.init();
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

  it('throws when stream state is read before initialization', () => {
    const store = new StreamingStore({ counter: counterReducer });
    const selectCount = store.createSelector((state) => state.counter.count);

    expect(() => store.getStreamState()).toThrow(
      'Cannot access StreamingStore.getStreamState() before Store.init() has been called.'
    );
    expect(() => selectCount()).toThrow(
      'Cannot access StreamingStore.getStreamState() before Store.init() has been called.'
    );
  });

  it('clears stream state on dispose', () => {
    const store = new StreamingStore({ counter: counterReducer });

    store.init();
    expect(store.getStreamState()).toBeInstanceOf(Kefir.Observable);
    store.dispose();

    expect(() => store.getStreamState()).toThrow(
      'Cannot access StreamingStore.getStreamState() before Store.init() has been called.'
    );
  });
});