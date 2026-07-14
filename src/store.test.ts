import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setContext } from 'svelte';
import createSagaMiddleware from 'redux-saga';
import { Store } from './svelte-store';
import { getStoreContext } from './utils/runtime-svelte/utils';
import { registerGlobalDevTools } from './global-dev-tools';
import {
  INTERNAL_SAGA_MANAGER_NAME,
  INTERNAL_STORE_UTILITY_DOMAIN,
} from './constants';
import { sagaManagerReducer } from './slices/saga-manager/saga-manager-slice';
import { storeUtilityReducer } from './slices/store-utility/store-utility-slice';
import { sagaManager } from './slices/saga-manager/sagas/manager';
import { deriveSagaName } from './utils/sagas/derive-saga-name';
import { DEFAULT_THROTTLED_SELECTOR_FREQUENCY } from './store-options';
import type { ReducersMap } from './types';

vi.mock('svelte', () => ({
  setContext: vi.fn(),
}));

vi.mock('./utils/runtime-svelte/utils', () => ({
  getStoreContext: vi.fn(() => undefined),
  getDispatch: vi.fn(),
}));

const mockSagaTask = {
  cancel: vi.fn(),
};
const mockSagaMiddleware = Object.assign(
  vi.fn(() => (next: any) => (action: any) => next(action)),
  { run: vi.fn(() => mockSagaTask) }
) as any;

vi.mock('redux-saga', () => ({
  default: vi.fn(() => mockSagaMiddleware),
}));

vi.mock('./global-dev-tools', () => ({
  registerGlobalDevTools: vi.fn(() => vi.fn()),
}));

vi.mock('./slices/saga-manager/sagas/manager', () => ({
  sagaManager: vi.fn(function* () {}),
}));

const mockedSetContext = vi.mocked(setContext);
const mockedGetStoreContext = vi.mocked(getStoreContext);
const mockedCreateSagaMiddleware = vi.mocked(createSagaMiddleware);
const mockedRunStoreSaga = vi.mocked(mockSagaMiddleware.run);
const mockedRegisterGlobalDevTools = vi.mocked(registerGlobalDevTools);
const mockedSagaManager = vi.mocked(sagaManager);
const packageDefaultMiddleware = mockSagaMiddleware;
const createOrderedMiddleware = (name: string, order: string[]) =>
  (() => (next: any) => (action: any) => {
    order.push(name);
    return next(action);
  }) as any;
const createActionRecorderMiddleware = (actions: unknown[]) =>
  (() => (next: any) => (action: any) => {
    actions.push(action);
    return next(action);
  }) as any;

describe('Store', () => {
  let store: Store;
  const internalReducers = {
    [INTERNAL_STORE_UTILITY_DOMAIN]: storeUtilityReducer,
    [INTERNAL_SAGA_MANAGER_NAME]: sagaManagerReducer,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetStoreContext.mockReturnValue(undefined);
    mockSagaMiddleware.mockImplementation(() => (next: any) => (action: any) => next(action));
    mockedRunStoreSaga.mockReturnValue(mockSagaTask as any);
    mockedRegisterGlobalDevTools.mockReturnValue(vi.fn());
    store = new Store();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('constructor maps', () => {
    it('registers app reducers during construction', () => {
      const reducer = (state: any = {}) => state;
      const mappedStore = new Store({ counter: reducer });

      expect(mappedStore.getReducers()).toEqual({ ...internalReducers, counter: reducer });
    });

    it('accepts a single middleware during construction', () => {
      const order: string[] = [];
      const mw = createOrderedMiddleware('constructor', order);
      const mappedStore = new Store(undefined, mw);

      mappedStore.init();
      mappedStore.dispatch({ type: 'TEST' });

      expect(order).toEqual(['constructor']);
    });

    it('accepts an array of middlewares during construction', () => {
      const order: string[] = [];
      const mw1 = createOrderedMiddleware('mw1', order);
      const mw2 = createOrderedMiddleware('mw2', order);
      const mappedStore = new Store(undefined, [mw1, mw2]);

      mappedStore.init();
      mappedStore.dispatch({ type: 'TEST' });

      expect(order).toEqual(['mw1', 'mw2']);
    });

    it('accepts selector throttling options as the last constructor argument', () => {
      const mappedStore = new Store(undefined, undefined, { throttledSelectorFrequency: 12.5 });

      expect((mappedStore as any).storeOptions).toEqual({
        throttledSelectorFrequency: 12.5,
        sagaMonitor: false,
        traceSelectors: false,
      });
    });

    it('accepts tracing options as the last constructor argument', () => {
      const mappedStore = new Store(undefined, undefined, {
        sagaMonitor: true,
        traceSelectors: true,
      });

      expect((mappedStore as any).storeOptions).toEqual({
        throttledSelectorFrequency: DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
        sagaMonitor: true,
        traceSelectors: true,
      });
    });

    it('defaults selector throttling to the package default FPS', () => {
      expect((store as any).storeOptions).toEqual({
        throttledSelectorFrequency: DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
        sagaMonitor: false,
        traceSelectors: false,
      });
    });

    it('leaves saga monitoring disabled by default', () => {
      expect((store as any).storeOptions.sagaMonitor).toBe(false);
    });

    it('leaves selector tracing disabled by default', () => {
      expect((store as any).storeOptions.traceSelectors).toBe(false);
    });

    it('normalizes false tracing options as disabled', () => {
      const mappedStore = new Store(undefined, undefined, {
        sagaMonitor: false,
        traceSelectors: false,
      });

      expect((mappedStore as any).storeOptions).toEqual({
        throttledSelectorFrequency: DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
        sagaMonitor: false,
        traceSelectors: false,
      });
    });

    it('throws for non-finite or out-of-range selector throttling options', () => {
      for (const throttledSelectorFrequency of [0, -1, 257, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => new Store(undefined, undefined, { throttledSelectorFrequency })).toThrow(
          'Store option "throttledSelectorFrequency" must be a finite number in the inclusive range 1..256 FPS.'
        );
      }
    });

    it('does not expose legacy public reducer or saga registration mutators', () => {
      expect('addReducer' in store).toBe(false);
      expect('addSaga' in store).toBe(false);
      expect('registerSagas' in store).toBe(false);
    });

    it('reserves the internal store utility reducer key', () => {
      const reducer = (state: any = {}) => state;

      expect(() => new Store({ [INTERNAL_STORE_UTILITY_DOMAIN]: reducer })).toThrow(
        `Reducer "${INTERNAL_STORE_UTILITY_DOMAIN}" is already added`
      );
    });

    it('reserves the internal saga manager crash reducer key', () => {
      const reducer = (state: any = {}) => state;

      expect(() => new Store({ [INTERNAL_SAGA_MANAGER_NAME]: reducer })).toThrow(
        `Reducer "${INTERNAL_SAGA_MANAGER_NAME}" is already added`
      );
    });

  });

  describe('getReducers', () => {
    it('includes package-owned internal reducers by default', () => {
      expect(store.getReducers()).toEqual(internalReducers);
    });

    it('returns a copy of the reducer registry', () => {
      const reducer = (state: any = {}) => state;
      const mappedStore = new Store({ counter: reducer });
      const reducers: ReducersMap = mappedStore.getReducers();
      reducers['newReducer'] = (s: any) => s;
      expect(mappedStore.getReducers()).toEqual({ ...internalReducers, counter: reducer });
    });
  });

  describe('createSelector', () => {
    it('returns the existing selector shape', () => {
      const reducer = (state = { value: 0 }) => state;
      const selectorStore = new Store({ counter: reducer });
      const selectCounter = selectorStore.createSelector((state) => state.counter.value);

      expect(selectCounter.select({
        [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false },
        [INTERNAL_SAGA_MANAGER_NAME]: {},
        counter: { value: 3 },
      })).toBe(3);
      expect(selectCounter.withStore).toBeInstanceOf(Function);
      expect(selectCounter.effect).toBeInstanceOf(Function);
    });

    it('enables selector trace logging through the Store option', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      vi.stubGlobal('requestAnimationFrame', undefined);
      vi.stubGlobal('cancelAnimationFrame', undefined);
      const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const reducer = Object.assign(
        (state = { value: 0 }, action: any) => {
          return action.type === 'counter/set' ? { value: action.payload } : state;
        },
        { initialState: { value: 0 } }
      );
      const selectorStore = new Store(
        { counter: reducer },
        undefined,
        { traceSelectors: true }
      );
      const selectCounter = selectorStore.createSelector((state) => state.counter.value);

      selectorStore.init();
      const unsubscribe = selectCounter().subscribe(() => undefined);
      selectorStore.dispatch({ type: 'counter/set', payload: 1 });
      vi.advanceTimersByTime(0);
      unsubscribe();

      expect(consoleInfo).toHaveBeenCalledWith('SUBSCRIBE SELECTOR CADENCE', 1);
      expect(consoleInfo).toHaveBeenCalledWith('SELECTOR CADENCE TICK', 0, 1);
      expect(consoleInfo).toHaveBeenCalledTimes(2);
      consoleInfo.mockRestore();
    });
    
    it('traces Store-created selector path growth only when enabled', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const initialState = {
        count: 0,
        label: 'zero',
        user: { name: 'Ada' },
      };
      const reducer = Object.assign((state = initialState) => state, { initialState });

      try {
        const defaultStore = new Store({ trace: reducer });
        const selectDefaultCount = defaultStore.createSelector((state) => state.trace.count);
        defaultStore.init();
        selectDefaultCount().subscribe(() => {})();

        expect(consoleInfoSpy).not.toHaveBeenCalled();

        const selectorStore = new Store({ trace: reducer });
        const selectCount = selectorStore.createSelector((state) => state.trace.count);
        const selectEqualPathCount = selectorStore.createSelector((state) => state.trace.label);
        const selectFewerPaths = selectorStore.createSelector((state) => state.trace);
        const selectMorePaths = selectorStore.createSelector(
          (state) => `${state.trace.user.name}:${state.trace.count}`
        );

        selectorStore.traceSelectors();
        selectorStore.init();
        selectCount().subscribe(() => {})();

        const accessTraces = () =>
          consoleInfoSpy.mock.calls
            .map((call) => call[1] as any)
            .filter((payload) => payload && 'accessedPathCount' in payload);

        expect(accessTraces()).toEqual([
          expect.objectContaining({
            accessedPathCount: 2,
            accessedPaths: ['trace', 'trace.count'],
            selectorSource: expect.stringContaining('state.trace.count'),
          }),
        ]);

        selectEqualPathCount().subscribe(() => {})();
        selectFewerPaths().subscribe(() => {})();
        expect(accessTraces()).toHaveLength(1);

        selectMorePaths().subscribe(() => {})();
        expect(accessTraces()).toHaveLength(2);
        expect(accessTraces()[1]).toEqual(
          expect.objectContaining({
            accessedPathCount: 4,
            accessedPaths: ['trace', 'trace.count', 'trace.user', 'trace.user.name'],
            selectorSource: expect.stringContaining('state.trace.user.name'),
          })
        );
      } finally {
        consoleInfoSpy.mockRestore();
      }
    });

    it('traces Store-created readable selector output cache request and cached counts', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const initialState = { count: 0 };
      const reducer = Object.assign((state = initialState) => state, { initialState });

      try {
        const selectorStore = new Store({ trace: reducer });
        const selectCount = selectorStore.createSelector((state) => state.trace.count);

        selectorStore.traceSelectors();
        selectorStore.init();
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

    it('uses configured Svelte selector FPS for readable emissions', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      let rafCallback: FrameRequestCallback | null = null;
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          rafCallback = cb;
          return 1;
        })
      );

      const triggerRAF = (timestamp: number) => {
        const cb = rafCallback;
        rafCallback = null;
        cb?.(timestamp);
      };
      const reducer = Object.assign(
        (state = { value: 0 }, action: any) => {
          return action.type === 'counter/set' ? { value: action.payload } : state;
        },
        { initialState: { value: 0 } }
      );
      const selectorStore = new Store(
        { counter: reducer },
        undefined,
        { throttledSelectorFrequency: 2.5 }
      );
      const selectCounter = selectorStore.createSelector((state) => state.counter.value);
      const values: number[] = [];

      selectorStore.init();
      const unsubscribe = selectCounter().subscribe((value) => values.push(value));
      selectorStore.dispatch({ type: 'counter/set', payload: 1 });
      triggerRAF(0);
      selectorStore.dispatch({ type: 'counter/set', payload: 2 });
      vi.advanceTimersByTime(399);
      triggerRAF(100);
      vi.advanceTimersByTime(1);
      triggerRAF(400);
      unsubscribe();

      expect(values).toEqual([0, 1, 2]);
    });

    it('shares one store-scoped cadence source across readable selectors and disposes scheduled work', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      let rafCallback: FrameRequestCallback | null = null;
      let nextFrameId = 1;
      const requestAnimationFrameMock = vi.fn((cb: FrameRequestCallback) => {
        rafCallback = cb;
        return nextFrameId++;
      });
      const cancelAnimationFrameMock = vi.fn();
      vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
      vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

      const triggerRAF = (timestamp: number) => {
        const cb = rafCallback;
        rafCallback = null;
        cb?.(timestamp);
      };
      const reducer = Object.assign(
        (state = { value: 0 }, action: any) => {
          return action.type === 'counter/set' ? { value: action.payload } : state;
        },
        { initialState: { value: 0 } }
      );
      const selectorStore = new Store({ counter: reducer }, undefined, { throttledSelectorFrequency: 10 });
      const selectCounter = selectorStore.createSelector((state) => state.counter.value);
      const selectDoubleCounter = selectorStore.createSelector((state) => state.counter.value * 2);
      const counterValues: number[] = [];
      const doubleValues: number[] = [];

      selectorStore.init();
      const unsubscribeCounter = selectCounter().subscribe((value) => counterValues.push(value));
      const unsubscribeDouble = selectDoubleCounter().subscribe((value) => doubleValues.push(value));
      selectorStore.dispatch({ type: 'counter/set', payload: 1 });
      selectorStore.dispatch({ type: 'counter/set', payload: 2 });

      expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
      expect(counterValues).toEqual([0]);
      expect(doubleValues).toEqual([0]);

      triggerRAF(0);
      expect(counterValues).toEqual([0, 2]);
      expect(doubleValues).toEqual([0, 4]);
      expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

      selectorStore.dispatch({ type: 'counter/set', payload: 3 });
      expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
      selectorStore.dispose();
      expect(vi.getTimerCount()).toBe(0);
      triggerRAF(100);
      unsubscribeCounter();
      unsubscribeDouble();

      expect(cancelAnimationFrameMock).not.toHaveBeenCalled();
      expect(counterValues).toEqual([0, 2]);
      expect(doubleValues).toEqual([0, 4]);
    });

    it('recreates selector cadence scheduling safely after dispose and re-init', () => {
      let rafCallback: FrameRequestCallback | null = null;
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          rafCallback = cb;
          return 1;
        })
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const triggerRAF = (timestamp: number) => {
        const cb = rafCallback;
        rafCallback = null;
        cb?.(timestamp);
      };
      const reducer = Object.assign(
        (state = { value: 0 }, action: any) => {
          return action.type === 'counter/set' ? { value: action.payload } : state;
        },
        { initialState: { value: 0 } }
      );
      const selectorStore = new Store({ counter: reducer }, undefined, { throttledSelectorFrequency: 10 });
      const selectCounter = selectorStore.createSelector((state) => state.counter.value);

      selectorStore.init();
      selectorStore.dispose();
      selectorStore.init({ counter: { value: 5 } });

      const values: number[] = [];
      const unsubscribe = selectCounter().subscribe((value) => values.push(value));
      selectorStore.dispatch({ type: 'counter/set', payload: 6 });
      triggerRAF(0);
      unsubscribe();

      expect(values).toEqual([5, 6]);
    });
  });

  describe('state', () => {
    it('returns the initialized Redux store state', () => {
      const reducer = Object.assign(
        (state = { value: 0 }) => state,
        { initialState: { value: 0 } }
      );
      const mappedStore = new Store({ counter: reducer });

      mappedStore.init({ counter: { value: 1 } });

      expect(mappedStore.state.counter).toEqual({ value: 1 });
    });

    it('throws if init() has not been called', () => {
      expect(() => store.state).toThrow(
        'Cannot access Store.state before Store.init() has been called.'
      );
    });
  });

  describe('getStateObservable', () => {
    it('returns the initialized readable store state', () => {
      store.init();

      expect(store.getStateObservable()).toEqual(
        expect.objectContaining({ subscribe: expect.any(Function) })
      );
    });

    it('throws if init() has not been called', () => {
      expect(() => store.getStateObservable()).toThrow(
        'Cannot access Store.getStateObservable() before Store.init() has been called.'
      );
    });
  });

  describe('dispatch', () => {
    it('returns the initialized Redux store dispatch function', () => {
      store.init();

      expect(store.dispatch({ type: 'TEST' })).toEqual({ type: 'TEST' });
    });

    it('throws if init() has not been called', () => {
      expect(() => store.dispatch).toThrow(
        'Cannot access Store.dispatch before Store.init() has been called.'
      );
    });
  });

  describe('init', () => {
    it('creates context with added reducers and starts the saga manager through the Store runner', () => {
      const reducer = (state: any = {}) => state;
      const mappedStore = new Store({ counter: reducer });

      mappedStore.init();

      expect(Object.keys((mappedStore as any).storeContext).sort()).toEqual(['store']);
      expect(mappedStore.state.counter).toEqual({});
      expect(mockedRunStoreSaga).toHaveBeenCalledTimes(1);

      const [sagaManagerArg, reduxStore, exposeContext] = mockedRunStoreSaga.mock.calls[0];
      expect(reduxStore).toBe((mappedStore as any).storeContext.store);
      sagaManagerArg(reduxStore, exposeContext).next();
      expect(mockedSagaManager).toHaveBeenCalledWith(
        reduxStore,
        exposeContext
      );
    });

    it('initializes with only internal reducers when consumers add none', () => {
      store.init();

      expect(Object.keys(store.state).sort()).toEqual(Object.keys(internalReducers).sort());
      expect(mockedRunStoreSaga).toHaveBeenCalledTimes(1);

      const [sagaManagerArg, reduxStore, exposeContext] = mockedRunStoreSaga.mock.calls[0];
      expect(reduxStore).toBe((store as any).storeContext.store);
      sagaManagerArg(reduxStore, exposeContext).next();
      expect(mockedSagaManager).toHaveBeenCalledWith(
        reduxStore,
        exposeContext
      );
    });

    it('applies custom middlewares before package middleware', () => {
      const order: string[] = [];
      const customMiddleware = createOrderedMiddleware('custom', order);
      mockSagaMiddleware.mockImplementation(() => (next: any) => (action: any) => {
        order.push('package');
        return next(action);
      });
      store.addMiddleware(customMiddleware);

      store.init();
      store.dispatch({ type: 'TEST' });

      expect(order).toEqual(['custom', 'package']);
    });

    it('assembles Store-owned saga middleware during Store init', () => {
      store.init();

      expect(mockedCreateSagaMiddleware).toHaveBeenCalledTimes(1);
      expect(mockedCreateSagaMiddleware.mock.calls[0]).toEqual([]);
      expect(packageDefaultMiddleware).toHaveBeenCalledTimes(1);
    });

    it('passes the configured saga monitor into Store-owned saga middleware', () => {
      const monitoredStore = new Store(undefined, undefined, { sagaMonitor: true });
      monitoredStore.init();

      expect(mockedCreateSagaMiddleware).toHaveBeenLastCalledWith({
        sagaMonitor: expect.objectContaining({
          effectTriggered: expect.any(Function),
          effectResolved: expect.any(Function),
          effectRejected: expect.any(Function),
          effectCancelled: expect.any(Function),
          actionDispatched: expect.any(Function),
        }),
      });
      expect(packageDefaultMiddleware).toHaveBeenCalledTimes(1);
    });

    it('does not pass saga monitoring when sagaMonitor is false', () => {
      const unmonitoredStore = new Store(undefined, undefined, { sagaMonitor: false });
      unmonitoredStore.init();

      expect(mockedCreateSagaMiddleware).toHaveBeenLastCalledWith();
      expect(packageDefaultMiddleware).toHaveBeenCalledTimes(1);
    });

    it('returns noop if store context already exists', () => {
      mockedGetStoreContext.mockReturnValueOnce({ store: {} } as any);

      const dispose = store.init();
      expect(dispose).toBeInstanceOf(Function);
      expect(mockedRunStoreSaga).not.toHaveBeenCalled();
    });

    it('returns a dispose function that follows Store.dispose behavior', () => {
      const mappedStore = new Store();

      const dispose = mappedStore.init();
      dispose();

      expect(mockSagaTask.cancel).toHaveBeenCalledTimes(1);
      expect(() => mappedStore.state).toThrow(
        'Cannot access Store.state before Store.init() has been called.'
      );
    });

    it('does not start any app sagas during init', () => {
      const mappedStore = new Store({ test: (s: any = {}) => s });

      mappedStore.init();

      expect(mockedRunStoreSaga).toHaveBeenCalledTimes(1);
    });

    it('does not set Svelte context during init', () => {
      store.init();

      expect(mockedSetContext).not.toHaveBeenCalled();
    });

    it('does not implicitly register devtools during init', () => {
      store.init();

      expect(mockedRegisterGlobalDevTools).not.toHaveBeenCalled();
    });
  });

  describe('initDevTool', () => {
    it('registers the initialized Store instance and returns the devtools cleanup', () => {
      const cleanUpDevTools = vi.fn();
      mockedRegisterGlobalDevTools.mockReturnValue(cleanUpDevTools);

      store.init();
      const returned = store.initDevTool();

      expect(mockedRegisterGlobalDevTools).toHaveBeenCalledTimes(1);
      expect(mockedRegisterGlobalDevTools).toHaveBeenCalledWith(store);
      expect(returned).toBe(cleanUpDevTools);
    });

    it('throws if init() has not been called', () => {
      expect(() => store.initDevTool()).toThrow(
        'Cannot initialize Store.initDevTool before Store.init() has been called.'
      );
      expect(mockedRegisterGlobalDevTools).not.toHaveBeenCalled();
    });

    it('cleans up devtools when the Store is disposed', () => {
      const cleanUpDevTools = vi.fn();
      mockedRegisterGlobalDevTools.mockReturnValue(cleanUpDevTools);

      store.init();
      store.initDevTool();
      store.dispose();

      expect(cleanUpDevTools).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('does not throw before init', () => {
      expect(() => store.dispose()).not.toThrow();
    });

    it('cancels the manager task started during init', () => {
      const managerTask = { cancel: vi.fn() };
      mockedRunStoreSaga.mockReturnValueOnce(managerTask as any);

      store.init();
      store.dispose();

      expect(managerTask.cancel).toHaveBeenCalledTimes(1);
    });

    it('clears initialized state', () => {
      function* mySaga() {}
      const mappedStore = new Store();

      mappedStore.init();
      mappedStore.dispose();

      expect(() => mappedStore.state).toThrow(
        'Cannot access Store.state before Store.init() has been called.'
      );
      expect(() => mappedStore.dispatch).toThrow(
        'Cannot access Store.dispatch before Store.init() has been called.'
      );
      expect(() => mappedStore.runSaga(mySaga)).toThrow(
        'Cannot run saga "mySaga" before Store.init() has been called.'
      );
    });
  });

  describe('runSaga', () => {
    it('dispatches startSaga with a name derived from the saga function', () => {
      const actions: unknown[] = [];
      function* mySaga() {}
      const mappedStore = new Store(
        { test: (s: any = {}) => s },
        createActionRecorderMiddleware(actions)
      );
      mappedStore.init();

      const returned = mappedStore.runSaga(mySaga);

      expect(actions).toContainEqual({
        type: 'sagaManager/startSaga',
        payload: ['mySaga', mySaga],
      });
      expect(returned).toBeInstanceOf(Function);
    });

    it('uses a deterministic generated name for anonymous saga functions', () => {
      const actions: unknown[] = [];
      const anonymousSaga = function* () { yield 'a'; };
      Object.defineProperty(anonymousSaga, 'name', { value: '' });
      const mappedStore = new Store(
        undefined,
        createActionRecorderMiddleware(actions)
      );
      mappedStore.init();

      mappedStore.runSaga(anonymousSaga);

      expect(actions).toContainEqual({
        type: 'sagaManager/startSaga',
        payload: [deriveSagaName(anonymousSaga), anonymousSaga],
      });
    });

    it('returned cancel fn dispatches stopSaga through the same Redux store', () => {
      const actions: unknown[] = [];
      function* mySaga() {}
      const mappedStore = new Store(
        undefined,
        createActionRecorderMiddleware(actions)
      );
      mappedStore.init();

      const stop = mappedStore.runSaga(mySaga);
      stop();

      expect(actions).toEqual([
        { type: 'sagaManager/startSaga', payload: ['mySaga', mySaga] },
        { type: 'sagaManager/stopSaga', payload: ['mySaga'] },
      ]);
    });

    it('throws if init() has not been called', () => {
      function* mySaga() {}
      const mappedStore = new Store();

      expect(() => mappedStore.runSaga(mySaga)).toThrow(
        'Cannot run saga "mySaga" before Store.init() has been called.'
      );
    });

    it('does not run the reserved internal manager saga directly', () => {
      const actions: unknown[] = [];
      const internalSaga = function* () {};
      Object.defineProperty(internalSaga, 'name', { value: INTERNAL_SAGA_MANAGER_NAME });
      const mappedStore = new Store(
        undefined,
        createActionRecorderMiddleware(actions)
      );
      mappedStore.init();

      expect(() => mappedStore.runSaga(internalSaga)).toThrow(
        `Saga "${INTERNAL_SAGA_MANAGER_NAME}" is reserved for internal saga management and cannot be run directly.`
      );
      expect(actions).toEqual([]);
    });
  });

  describe('addMiddleware', () => {
    it('accepts a single middleware', () => {
      const order: string[] = [];
      const mw = createOrderedMiddleware('mw', order);
      store.addMiddleware(mw);

      store.init();
      store.dispatch({ type: 'TEST' });

      expect(order).toEqual(['mw']);
    });

    it('accepts an array of middlewares', () => {
      const order: string[] = [];
      const mw1 = createOrderedMiddleware('mw1', order);
      const mw2 = createOrderedMiddleware('mw2', order);
      store.addMiddleware([mw1, mw2]);

      store.init();
      store.dispatch({ type: 'TEST' });

      expect(order).toEqual(['mw1', 'mw2']);
    });

    it('accumulates middlewares from multiple calls', () => {
      const order: string[] = [];
      const mw1 = createOrderedMiddleware('mw1', order);
      const mw2 = createOrderedMiddleware('mw2', order);
      store.addMiddleware(mw1);
      store.addMiddleware(mw2);

      store.init();
      store.dispatch({ type: 'TEST' });

      expect(order).toEqual(['mw1', 'mw2']);
    });

    it('orders constructor middlewares before later addMiddleware middlewares', () => {
      const order: string[] = [];
      const constructorMiddleware = createOrderedMiddleware('constructor', order);
      const addedMiddleware = createOrderedMiddleware('added', order);
      const mappedStore = new Store(undefined, constructorMiddleware);
      mappedStore.addMiddleware(addedMiddleware);

      mappedStore.init();
      mappedStore.dispatch({ type: 'TEST' });

      expect(order).toEqual(['constructor', 'added']);
    });
  });

  describe('multiple instances', () => {
    it('maintains separate registries', () => {
      const reducerA = (s: any = {}) => s;
      const reducerB = (s: any = {}) => s;
      const storeA = new Store({ a: reducerA });
      const storeB = new Store({ b: reducerB });

      expect(storeA.getReducers()).toEqual({ ...internalReducers, a: reducerA });
      expect(storeB.getReducers()).toEqual({ ...internalReducers, b: reducerB });
    });
  });
});
