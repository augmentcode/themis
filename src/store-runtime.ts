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
  type NormalizedSelectorTracingOptions,
  type NormalizedStoreOptions,
  type ReducersMap,
  type StoreOptions,
  type StoreMiddleware,
  type StoreReducerFunction,
  type StoreState,
  type StoreStateFromStateMap,
  type StoreStateMap,
  type SelectorTraceSummary,
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
import { normalizeSelectorTracingOptions, normalizeStoreOptions } from './store-options';
import { createSelectorCadenceSource } from './utils/selector-core/throttled-selector-options';
import {
  renderAccessedPaths,
} from './utils/selector-core/create-cached-selector';
import { evictSelectorOutputsForStateSource } from './utils/selector-core/selector-output-cache';
import { registerSelectorTracingBridge } from './utils/selector-core/selector-tracing-bridge';
import {
  getEmptySelectorTraceSummary,
  SelectorTraceSummaryCollector,
} from './selector-trace-summary';
import type {
  CachedSelector,
  SelectorCadenceSource,
  SelectorComputationTraceOptions,
  SelectorTrace,
  SelectorTraceReporter,
} from './utils/types';

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
      readCurrentState();
      selectorCadenceSource.requestTick();
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
  private readonly selectorTraceReporter: SelectorTraceReporter<any, any, any[]> | undefined;
  private readonly selectorTraceSummaryCollector: SelectorTraceSummaryCollector | undefined;
  private selectorTraceSummaryInterval: ReturnType<typeof setInterval> | undefined;
  private selectorTracingOptions: NormalizedSelectorTracingOptions;
  private readonly legacySelectorTracingActivationAllowed: boolean;
  protected readonly storeOptions: NormalizedStoreOptions;

  constructor(
    reducersMap?: TReducers & StoreReducersInput<TStateMap>,
    middleware?: StoreMiddlewareInput,
    options?: StoreOptions
  ) {
    this.storeOptions = normalizeStoreOptions(options);
    this.selectorTracingOptions = this.storeOptions.traceSelectors;
    this.legacySelectorTracingActivationAllowed =
      options?.traceSelectors === undefined || options.traceSelectors === false;
    this.selectorTraceSummaryCollector =
      this.selectorTracingOptions.summaryEnabled
        ? new SelectorTraceSummaryCollector(getSelectorSourceSnippet)
        : undefined;
    this.selectorTracingEnabled =
      (
        this.selectorTracingOptions.traceExecution ||
        this.selectorTracingOptions.traceCache ||
        this.selectorTracingOptions.traceInvalidation ||
        this.selectorTracingOptions.traceArguments ||
        this.selectorTracingOptions.traceResults ||
        this.selectorTraceSummaryCollector !== undefined
      );
    this.selectorTraceReporter = (trace) => this.reportSelectorTrace(trace);
    if (this.selectorTracingEnabled) {
      this.registerSelectorTracingBridge();
    }
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
        {
          traceSelectors: this.selectorTracingOptions.traceCadence,
        }
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
    this.startSelectorTraceSummaryInterval();

    return () => {
      this.dispose();
    };
  }

  getSelectorTraceReporter<
    STATE,
    R,
    ARGS extends unknown[] = [],
  >(): SelectorTraceReporter<STATE, R, ARGS> | undefined {
    return this.selectorTraceReporter as SelectorTraceReporter<STATE, R, ARGS> | undefined;
  }

  shouldTraceSelectorCache(): boolean {
    return (
      this.selectorTracingEnabled &&
      (this.selectorTracingOptions.traceCache || this.selectorTraceSummaryCollector !== undefined)
    );
  }

  getSelectorTraceSummary(): SelectorTraceSummary {
    return this.selectorTraceSummaryCollector?.snapshot() ?? getEmptySelectorTraceSummary();
  }

  private registerSelectorTracingBridge(): void {
    registerSelectorTracingBridge(this, {
      getComputationTraceOptions: <STATE, R, ARGS extends unknown[]>() => {
        const traceReporter = this.selectorTraceReporter as
          | SelectorTraceReporter<STATE, R, ARGS>
          | undefined;
        if (
          !this.selectorTracingEnabled ||
          !traceReporter ||
          !(
            this.selectorTracingOptions.traceExecution ||
            this.selectorTracingOptions.traceInvalidation ||
            this.selectorTracingOptions.traceArguments ||
            this.selectorTracingOptions.traceResults ||
            this.selectorTraceSummaryCollector !== undefined
          )
        ) {
          return undefined;
        }
        return {
          traceReporter,
          traceExecution:
            this.selectorTracingOptions.traceExecution ||
            this.selectorTraceSummaryCollector !== undefined,
          traceInvalidation:
            this.selectorTracingOptions.traceInvalidation ||
            this.selectorTraceSummaryCollector !== undefined,
          traceArguments: this.selectorTracingOptions.traceArguments,
          traceResults:
            this.selectorTracingOptions.traceResults ||
            this.selectorTraceSummaryCollector !== undefined,
        } satisfies SelectorComputationTraceOptions<STATE, R, ARGS>;
      },
      getCacheTraceReporter: <STATE, R, ARGS extends unknown[]>() =>
        this.selectorTracingEnabled &&
        (this.selectorTracingOptions.traceCache || this.selectorTraceSummaryCollector !== undefined)
          ? (this.selectorTraceReporter as SelectorTraceReporter<STATE, R, ARGS> | undefined)
          : undefined,
    });
  }

  private reportSelectorTrace<STATE, R, ARGS extends unknown[] = []>(
    trace: SelectorTrace<STATE, R, ARGS>
  ): void {
    if (!this.selectorTracingEnabled) {
      return;
    }

    this.selectorTraceSummaryCollector?.record(trace);

    if ('observableCacheRequestCount' in trace) {
      if (!this.selectorTracingOptions.traceCache) {
        return;
      }
      console.info('[themis] selector trace', {
        observableCacheRequestCount: trace.observableCacheRequestCount,
        observableCacheCachedCount: trace.observableCacheCachedCount,
        outputCacheStatus: trace.outputCacheStatus,
        outputCacheRequestCount: trace.outputCacheRequestCount,
        outputCacheHitCount: trace.outputCacheHitCount,
        outputCacheMissCount: trace.outputCacheMissCount,
        selectorSource: getSelectorSourceSnippet(trace.selectorFunc),
      });
      return;
    }

    const reportExecution =
      this.selectorTracingOptions.traceExecution &&
      trace.executionDurationMs !== undefined &&
      trace.executionDurationMs >= this.selectorTracingOptions.minDurationMs &&
      trace.accessedPaths !== undefined &&
      trace.parsedPaths !== undefined;
    const reportInvalidation =
      this.selectorTracingOptions.traceInvalidation && trace.invalidationReason !== undefined;
    const reportArguments =
      this.selectorTracingOptions.traceArguments && trace.argumentsChanged !== undefined;
    const reportResults =
      this.selectorTracingOptions.traceResults && trace.resultOutcome !== undefined;

    if (!reportExecution && !reportInvalidation && !reportArguments && !reportResults) {
      return;
    }

    const payload: Record<string, unknown> = {
      recomputationCount: trace.recomputationCount,
      selectorSource: getSelectorSourceSnippet(trace.selectorFunc),
    };
    if (reportExecution && trace.accessedPaths && trace.parsedPaths) {
      payload.accessedPathCount = trace.accessedPathCount;
      payload.accessedPaths = renderAccessedPaths(trace.accessedPaths, trace.parsedPaths);
      payload.executionDurationMs = trace.executionDurationMs;
    }
    if (reportInvalidation) {
      payload.invalidationReason = trace.invalidationReason;
      payload.changedAccessedPaths =
        trace.changedAccessedPaths && trace.parsedPaths
          ? renderAccessedPaths(trace.changedAccessedPaths, trace.parsedPaths)
          : [];
    }
    if (reportArguments) {
      payload.argumentsChanged = trace.argumentsChanged;
      payload.changedArguments = trace.changedArguments ?? [];
    }
    if (reportResults) {
      payload.resultOutcome = trace.resultOutcome;
    }
    console.info('[themis] selector trace', payload);
  }

  traceSelectors(): void {
    if (
      !this.legacySelectorTracingActivationAllowed ||
      !this.selectorTraceReporter
    ) {
      return;
    }
    this.selectorTracingOptions = normalizeSelectorTracingOptions(true);
    this.selectorTracingEnabled = true;
    this.registerSelectorTracingBridge();
  }

  private startSelectorTraceSummaryInterval(): void {
    if (!this.selectorTraceSummaryCollector || this.selectorTraceSummaryInterval !== undefined) {
      return;
    }
    this.selectorTraceSummaryInterval = setInterval(() => {
      console.info('[themis] selector trace summary', this.getSelectorTraceSummary());
    }, this.selectorTracingOptions.summaryIntervalMs);
  }

  private disposeSelectorTraceSummaryInterval(): void {
    if (this.selectorTraceSummaryInterval === undefined) return;
    clearInterval(this.selectorTraceSummaryInterval);
    this.selectorTraceSummaryInterval = undefined;
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
    evictSelectorOutputsForStateSource(this);
    this.disposeSelectorTraceSummaryInterval();

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
