import {
  applyMiddleware,
  combineReducers,
  legacy_createStore as createStore,
} from 'redux';
import Kefir, {
  type Emitter,
  type Observable,
  type Property,
} from 'kefir';
import createSagaMiddleware from 'redux-saga';
import type { Saga, SagaMonitor, Task } from 'redux-saga';
import {
  type PreloadedStoreState,
  type NormalizedStoreOptions,
  type ReducersMap,
  type StoreOptions,
  type StoreMiddleware,
  type StoreReducerFunction,
  type StoreState,
  type StoreStateFromStateMap,
  type StoreStateMap,
} from './types';
import type { ReduxStoreContext } from './internal-types';
import {
  INTERNAL_SAGA_MANAGER_NAME,
  INTERNAL_STORE_UTILITY_DOMAIN,
} from './constants';
import { sagaManager } from './slices/saga-manager/sagas/manager';
import {
  sagaManagerReducer,
  startSaga,
  stopSaga,
} from './slices/saga-manager/saga-manager-slice';
import type { SagaCrashState } from './slices/saga-manager/saga-manager-slice';
import { storeUtilityReducer } from './slices/store-utility/store-utility-slice';
import type { StoreUtilityState } from './slices/store-utility/store-utility-slice';
import { registerGlobalDevTools } from './global-dev-tools';
import { deriveSagaName } from './utils/sagas/derive-saga-name';
import { normalizeStoreOptions } from './store-options';
import {
  createSelectorCadenceSource,
  type SelectorCadenceSource,
} from './utils/selector-core/throttled-selector-options';
import {
  renderAccessedPaths,
  type CachedSelector,
  type SelectorTrace,
  type SelectorTraceReporter,
} from './utils/selector-core/create-cached-selector';

const MAX_SELECTOR_SOURCE_SNIPPET_LINES = 5;
const MAX_SELECTOR_SOURCE_SNIPPET_LENGTH = 500;

const getSelectorSourceSnippet = (selectorFunc: CachedSelector<any, any, any[]>): string => {
  return selectorFunc
    .toString()
    .split(/\r?\n/)
    .slice(0, MAX_SELECTOR_SOURCE_SNIPPET_LINES)
    .join('\n')
    .slice(0, MAX_SELECTOR_SOURCE_SNIPPET_LENGTH);
};

type DefaultStoreReducersMap = {
  [INTERNAL_STORE_UTILITY_DOMAIN]: typeof storeUtilityReducer;
  [INTERNAL_SAGA_MANAGER_NAME]: typeof sagaManagerReducer;
};

type DefaultStoreStateMap = {
  [INTERNAL_STORE_UTILITY_DOMAIN]: StoreUtilityState;
  [INTERNAL_SAGA_MANAGER_NAME]: SagaCrashState;
};

type RuntimeStoreStateStream<TState> = {
  observable: Property<TState, never>;
  getSnapshot(): TState;
  dispose(): void;
};

const createCadencedStoreStateStream = <TState>(
  store: ReduxStoreContext['store'],
  selectorCadenceSource: SelectorCadenceSource
): RuntimeStoreStateStream<TState> => {
  let currentState = store.getState() as TState;
  let lastEmitted = currentState;
  let activeEmitter: Emitter<TState, never> | undefined;
  let activeCleanup: (() => void) | undefined;
  let disposed = false;

  const readCurrentState = (): TState => {
    currentState = store.getState() as TState;
    return currentState;
  };

  const emitLatest = (): void => {
    if (disposed || !activeEmitter) {
      return;
    }
    const latestState = readCurrentState();
    if (latestState !== lastEmitted) {
      lastEmitted = latestState;
      activeEmitter.value(latestState);
    }
  };

  const observable = Kefir.stream<TState, never>((emitter) => {
    if (disposed) {
      emitter.end();
      return;
    }

    currentState = store.getState() as TState;
    lastEmitted = currentState;
    activeEmitter = emitter;
    const unsubscribeStore = store.subscribe(() => {
      currentState = store.getState() as TState;
    });
    const unsubscribeCadence = selectorCadenceSource.subscribe(emitLatest);

    activeCleanup = () => {
      unsubscribeCadence();
      unsubscribeStore();
      activeEmitter = undefined;
      activeCleanup = undefined;
    };

    return activeCleanup;
  }).toProperty(() => {
    const snapshot = readCurrentState();
    lastEmitted = snapshot;
    return snapshot;
  });

  return {
    observable,
    getSnapshot: readCurrentState,
    dispose() {
      disposed = true;
      activeEmitter?.end();
      activeCleanup?.();
      activeEmitter = undefined;
      activeCleanup = undefined;
    },
  };
};

export type StoreReducersInput<TStateMap extends StoreStateMap> = {
  [Domain in keyof TStateMap]: StoreReducerFunction<TStateMap[Domain]>;
};

export type StoreReducersMap<
  TStateMap extends StoreStateMap,
  TReducers extends StoreReducersInput<TStateMap> = StoreReducersInput<TStateMap>,
> = DefaultStoreReducersMap & TReducers;

export type StoreBoundState<TStateMap extends StoreStateMap> = StoreStateFromStateMap<
  DefaultStoreStateMap & TStateMap
>;
export type StoreMiddlewareInput = StoreMiddleware | StoreMiddleware[];

const createStoreSagaMonitor = (): SagaMonitor => ({
  effectTriggered(event) {
    console.info('[themis:saga] effectTriggered', event);
  },
  effectResolved(effectId, result) {
    console.info('[themis:saga] effectResolved', effectId, result);
  },
  effectRejected(effectId, error) {
    console.info('[themis:saga] effectRejected', effectId, error);
  },
  effectCancelled(effectId) {
    console.info('[themis:saga] effectCancelled', effectId);
  },
  actionDispatched(action) {
    console.info('[themis:saga] actionDispatched', action);
  },
});

export abstract class StoreRuntime<
  TStateMap extends StoreStateMap = {},
  TReducers extends StoreReducersInput<TStateMap> = StoreReducersInput<TStateMap>,
> {
  private reducers: StoreReducersMap<TStateMap, TReducers> = {
    [INTERNAL_STORE_UTILITY_DOMAIN]: storeUtilityReducer,
    [INTERNAL_SAGA_MANAGER_NAME]: sagaManagerReducer,
  } as StoreReducersMap<TStateMap, TReducers>;
  private middlewares: StoreMiddleware[] = [];
  private readonly sagaMiddleware: ReturnType<typeof createSagaMiddleware>;
  private tasksStarted: Task[] = [];
  private storeContext: ReduxStoreContext | undefined;
  private selectorCadenceSource: SelectorCadenceSource | undefined;
  private cadencedStoreStateStream:
    | RuntimeStoreStateStream<StoreBoundState<TStateMap>>
    | undefined;
  private disposeDevTools: (() => void) | undefined;
  private selectorTracingEnabled = false;
  private maxLoggedSelectorAccessedPathCount: number | undefined;
  protected readonly storeOptions: NormalizedStoreOptions;

  constructor(
    reducersMap?: TReducers & StoreReducersInput<TStateMap>,
    middleware?: StoreMiddlewareInput,
    options?: StoreOptions
  ) {
    this.storeOptions = normalizeStoreOptions(options);
    this.sagaMiddleware = this.storeOptions.sagaMonitor
      ? createSagaMiddleware({ sagaMonitor: createStoreSagaMonitor() })
      : createSagaMiddleware();
    for (const [name, reducer] of Object.entries(reducersMap ?? {})) {
      this.registerReducer(name, reducer);
    }
    if (middleware !== undefined) {
      this.addMiddleware(middleware);
    }
  }

  private registerReducer(name: string, reducer: StoreReducerFunction): void {
    const reducers = this.reducers as ReducersMap;
    if (reducers[name] !== undefined) {
      throw new Error(
        `Reducer "${name}" is already added. Each reducer name must be unique.`
      );
    }
    reducers[name] = reducer;
  }

  addMiddleware(middleware: StoreMiddlewareInput): void {
    if (Array.isArray(middleware)) {
      this.middlewares.push(...middleware);
    } else {
      this.middlewares.push(middleware);
    }
  }

  private getMiddlewarePipeline(): StoreMiddleware[] {
    return [...this.middlewares, this.sagaMiddleware];
  }

  private runSagaSafely<S extends Saga>(saga: S, ...args: Parameters<S>): Task {
    const task = this.sagaMiddleware.run(saga, ...args);
    this.tasksStarted.push(task);
    return task;
  }

  private createExtendedDefaultState(initialState?: PreloadedStoreState): StoreState {
    const reducers = this.reducers as ReducersMap;

    return Object.keys(reducers).reduce<StoreState>((state, domain) => {
      return {
        ...state,
        [domain]: {
          ...(reducers[domain] as any).initialState,
          ...(initialState ? initialState[domain] : {}),
        },
      };
    }, {} as StoreState);
  }

  private stopSagas(): void {
    for (const task of this.tasksStarted) {
      task.cancel();
    }
    this.tasksStarted = [];
  }

  private getOrCreateSelectorCadenceSource(): SelectorCadenceSource {
    if (!this.selectorCadenceSource) {
      this.selectorCadenceSource = createSelectorCadenceSource(
        this.storeOptions.throttledSelectorFrequency,
        { traceSelectors: this.storeOptions.traceSelectors }
      );
    }

    return this.selectorCadenceSource;
  }

  private disposeSelectorCadenceSource(): void {
    this.selectorCadenceSource?.dispose();
    this.selectorCadenceSource = undefined;
  }

  private disposeCadencedStoreStateStream(): void {
    this.cadencedStoreStateStream?.dispose();
    this.cadencedStoreStateStream = undefined;
  }

  getStoreStateStream(): Observable<StoreBoundState<TStateMap>, any> {
    if (!this.cadencedStoreStateStream) {
      throw new Error(
        'Cannot access StoreRuntime.getStoreStateStream() before Store.init() has been called.'
      );
    }

    return this.cadencedStoreStateStream.observable;
  }

  getStoreStateSnapshot(): StoreBoundState<TStateMap> {
    if (!this.cadencedStoreStateStream) {
      throw new Error(
        'Cannot access StoreRuntime.getStoreStateSnapshot() before Store.init() has been called.'
      );
    }

    return this.cadencedStoreStateStream.getSnapshot();
  }

  getReducers(): StoreReducersMap<TStateMap, TReducers> {
    return { ...this.reducers };
  }

  get state(): StoreBoundState<TStateMap> {
    if (!this.storeContext) {
      throw new Error(
        'Cannot access Store.state before Store.init() has been called.'
      );
    }
    return this.storeContext.store.getState() as StoreBoundState<TStateMap>;
  }

  get dispatch(): ReduxStoreContext['store']['dispatch'] {
    if (!this.storeContext) {
      throw new Error(
        'Cannot access Store.dispatch before Store.init() has been called.'
      );
    }
    return this.storeContext.store.dispatch;
  }

  /**
   * Return an existing store context that should prevent re-initialization.
   * Defaults to the instance-level context (guards against double init());
   * framework-specific subclasses can override to consult external contexts.
   */
  protected getExistingStoreContext(): ReduxStoreContext | undefined {
    return this.storeContext;
  }

  protected initStoreContext(initialState?: PreloadedStoreState): ReduxStoreContext | undefined {
    const existingStoreContext = this.getExistingStoreContext();
    if (existingStoreContext) {
      return undefined;
    }

    const middlewares = this.getMiddlewarePipeline();

    const rootReducer = combineReducers(this.reducers as ReducersMap);
    const store = createStore(
      rootReducer,
      this.createExtendedDefaultState(initialState),
      applyMiddleware(...middlewares)
    );
    const storeContext: ReduxStoreContext = {
      store,
    };
    this.storeContext = storeContext;
    this.cadencedStoreStateStream = createCadencedStoreStateStream<StoreBoundState<TStateMap>>(
      store,
      this.getOrCreateSelectorCadenceSource()
    );

    return storeContext;
  }

  init(initialState?: PreloadedStoreState): () => void {
    const storeContext = this.initStoreContext(initialState);
    if (!storeContext) {
      return () => {};
    }

    this.startSagaManager(storeContext);

    return () => {
      this.dispose();
    };
  }

  getSelectorTraceReporter<
    STATE,
    R,
    ARGS extends unknown[] = [],
  >(): SelectorTraceReporter<STATE, R, ARGS> {
    return (trace) => this.reportSelectorTrace(trace);
  }

  shouldTraceSelectorCache(): boolean {
    return this.selectorTracingEnabled;
  }

  private reportSelectorTrace<STATE, R, ARGS extends unknown[] = []>(
    trace: SelectorTrace<STATE, R, ARGS>
  ): void {
    if (!this.selectorTracingEnabled) {
      return;
    }

    if ('observableCacheRequestCount' in trace) {
      console.info('[themis] selector trace', {
        observableCacheRequestCount: trace.observableCacheRequestCount,
        observableCacheCachedCount: trace.observableCacheCachedCount,
        selectorSource: getSelectorSourceSnippet(trace.selectorFunc),
      });
      return;
    }

    if (
      this.maxLoggedSelectorAccessedPathCount !== undefined &&
      trace.accessedPathCount <= this.maxLoggedSelectorAccessedPathCount
    ) {
      return;
    }

    this.maxLoggedSelectorAccessedPathCount = trace.accessedPathCount;
    const accessedPaths = renderAccessedPaths(trace.accessedPaths, trace.parsedPaths);
    console.info('[themis] selector trace', {
      accessedPathCount: trace.accessedPathCount,
      accessedPaths,
      selectorSource: getSelectorSourceSnippet(trace.selectorFunc),
    });
  }

  traceSelectors(): void {
    this.selectorTracingEnabled = true;
  }

  protected startSagaManager(storeContext: ReduxStoreContext): void {
    this.runSagaSafely(
      sagaManager,
      storeContext.store,
      (runningTasksContext: ReduxStoreContext['tasks']) => {
        storeContext.tasks = runningTasksContext;
      }
    );
  }

  initDevTool(): () => void {
    if (!this.storeContext) {
      throw new Error(
        'Cannot initialize Store.initDevTool before Store.init() has been called.'
      );
    }

    this.disposeDevTools = registerGlobalDevTools(this);
    return this.disposeDevTools;
  }

  dispose(): void {
    if (!this.storeContext) {
      this.disposeCadencedStoreStateStream();
      this.disposeSelectorCadenceSource();
      return;
    }

    this.disposeDevTools?.();
    this.disposeDevTools = undefined;
    this.disposeCadencedStoreStateStream();
    this.stopSagas();
    this.storeContext = undefined;
    this.disposeSelectorCadenceSource();
  }

  runSaga<TSaga extends Saga>(saga: TSaga): () => void {
    const sagaName = deriveSagaName(saga);

    if (!this.storeContext) {
      throw new Error(
        `Cannot run saga "${sagaName}" before Store.init() has been called.`
      );
    }
    if (sagaName === INTERNAL_SAGA_MANAGER_NAME) {
      throw new Error(
        `Saga "${INTERNAL_SAGA_MANAGER_NAME}" is reserved for internal saga management and cannot be run directly.`
      );
    }
    const { store } = this.storeContext;
    store.dispatch(startSaga(sagaName, saga));
    return () => {
      store.dispatch(stopSaga(sagaName));
    };
  }
}
