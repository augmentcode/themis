import type { Middleware, Store as ReduxStoreBase, UnknownAction } from 'redux';
import type { SagaGenerator } from 'typed-redux-saga';
import type { Observable } from 'kefir';
import type { StoreRuntime } from './store-runtime';

// ============================================================================
// Saga Status Types
// ============================================================================

type SagaCrashRecord = {
  crashedAt: Date;
  error: Error;
};

type SagaStatusRecord = {
  isRunning: boolean;
  launchedAtTs: number | null;
  crashes: SagaCrashRecord[];
};

// ============================================================================
// Action Types
// ============================================================================

export type StoreAction<PL = undefined> = {
  type: string;
  payload: PL;
};

export type GenericAction = StoreAction<any>;

export type PayloadModifier<ARGS extends any[], PL> = (...args: ARGS) => PL;

export type StoreActionCreator<ARGS extends any[] = [], PL = ARGS> = {
  (...args: ARGS): StoreAction<PL>;
  type: string;
  toString: () => string;
};

export type SuccessResponse<PL, R> = {
  request: PL;
  response: R;
};

export type ErrorResponse<PL> = {
  request: PL;
  error: Error;
};

export type StoreAsyncAction<PL = undefined, R = unknown> = {
  type: string;
  asyncActionType: string;
  payload: PL;
  promise: Promise<R>;
  success: StoreActionCreator<[R], SuccessResponse<PL, R>>;
  failure: StoreActionCreator<[Error], ErrorResponse<PL>>;
};

export type StoreAsyncActionCreator<ARGS extends any[] = [], PL = ARGS, R = unknown> = {
  (...args: ARGS): StoreAsyncAction<PL, R>;
  type: string;
  asyncActionType: string;
  success: StoreActionCreator<[R], SuccessResponse<PL, R>>;
  failure: StoreActionCreator<[Error], ErrorResponse<PL>>;
  toString: () => string;
};

// ============================================================================
// Middleware Types
// ============================================================================

export type MiddlewareFunction = (
  action: GenericAction,
  api: { dispatch: ReduxStore["dispatch"]; getState: ReduxStore["getState"] }
) => GenericAction | Promise<GenericAction> | void;

export type StoreMiddleware = Middleware<any, StoreState, any>;

// ============================================================================
// Store Types
// ============================================================================

type StateDomain = string;

export type StoreStateMap = Record<StateDomain, any>;
export type StoreReducerFunction<TState = any> = (state: any, action: any) => TState;
export type ReducersMap = Record<string, StoreReducerFunction>;

export type SelectorTracingOptions = {
  traceExecution?: boolean;
  traceCache?: boolean;
  traceInvalidation?: boolean;
  traceArguments?: boolean;
  traceResults?: boolean;
  traceCadence?: boolean;
  minDurationMs?: number;
  minRecomputationCount?: number;
  minCacheMissCount?: number;
  summaryEnabled?: boolean;
  summaryIntervalMs?: number;
};

export type NormalizedSelectorTracingOptions = {
  traceExecution: boolean;
  traceCache: boolean;
  traceInvalidation: boolean;
  traceArguments: boolean;
  traceResults: boolean;
  traceCadence: boolean;
  minDurationMs: number;
  minRecomputationCount: number;
  minCacheMissCount: number;
  summaryEnabled: boolean;
  summaryIntervalMs: number;
};

export type SelectorTraceInvalidationReason =
  | 'first-execution'
  | 'selector-arguments-changed'
  | 'accessed-state-paths-changed'
  | 'previous-result-unavailable';

export type SelectorTraceResultOutcome = 'initial' | 'changed' | 'retained-reference';

export type SelectorTraceDurationSummary = Readonly<{
  count: number;
  totalMs: number;
  averageMs: number;
  maximumMs: number;
  p95Ms: number;
}>;

export type SelectorTraceCacheSummary = Readonly<{
  requestCount: number;
  hitCount: number;
  missCount: number;
  hitRatio: number | null;
}>;

export type SelectorTraceSelectorSummary = Readonly<{
  selectorSource: string;
  executionCount: number;
  recomputationCount: number;
  invalidationReasons: Readonly<Record<SelectorTraceInvalidationReason, number>>;
  resultOutcomes: Readonly<Record<SelectorTraceResultOutcome, number>>;
  duration: SelectorTraceDurationSummary;
  cache: SelectorTraceCacheSummary;
}>;

export type SelectorTraceSummary = ReadonlyArray<SelectorTraceSelectorSummary>;

export type SelectorTracePeriodSummary = Readonly<{
  selectorSource: string;
  executionCount: number;
  recomputationCount: number;
  invalidationReasons: Readonly<Record<SelectorTraceInvalidationReason, number>>;
  resultOutcomes: Readonly<Record<SelectorTraceResultOutcome, number>>;
  arguments: Readonly<{
    count: number;
    changedCount: number;
  }>;
  duration: Readonly<Omit<SelectorTraceDurationSummary, 'p95Ms'>>;
  cache: SelectorTraceCacheSummary;
}>;

export type SelectorTraceAggregate = Readonly<{
  intervalMs: number;
  selectors: ReadonlyArray<SelectorTracePeriodSummary>;
}>;

export type SelectorDetailTraceEvent = Readonly<{
  kind: 'selector' | 'cache';
  selectorSource: string;
  [field: string]: unknown;
}>;

export type SelectorCadenceTraceEvent = Readonly<{
  type: 'tick' | 'subscribe';
  timestamp?: number;
  listenerCount: number;
}>;

export type SagaMonitorTraceEvent = Readonly<
  | { type: 'effectTriggered'; event: unknown }
  | { type: 'effectResolved'; effectId: number; result: unknown }
  | { type: 'effectRejected'; effectId: number; error: unknown }
  | { type: 'effectCancelled'; effectId: number }
  | { type: 'actionDispatched'; action: unknown }
>;

export type RuntimeErrorTraceEvent = Readonly<{
  error: unknown;
  source?: string;
  message?: string;
  payload?: unknown;
}>;

export type StoreRuntimeErrorReporter = (event: RuntimeErrorTraceEvent) => void;

export type StoreTraceStreams = Readonly<{
  selectorDetail: Observable<SelectorDetailTraceEvent, never>;
  selectorSummary: Observable<SelectorTraceSummary, never>;
  selectorCadence: Observable<SelectorCadenceTraceEvent, never>;
  sagaMonitor: Observable<SagaMonitorTraceEvent, never>;
  runtimeError: Observable<RuntimeErrorTraceEvent, never>;
}>;

export type StoreLoggerFactory = (streams: StoreTraceStreams) => void | (() => void);
export type StoreOptions = {
  /**
   * Reactive selector emission frequency in frames per second.
   * Defaults to 64 FPS and accepts finite values in the inclusive 1..256 range.
   */
  throttledSelectorFrequency?: number;
  /**
   * Enables the built-in redux-saga monitor for Store-owned saga middleware.
   * Defaults to false, leaving saga monitoring disabled.
   */
  sagaMonitor?: boolean;
  /**
   * Enables Store-owned Redux action logging. Defaults to false.
   */
  logReduxActions?: boolean;
  /**
   * Enables diagnostic selector flush tracing.
   * Defaults to false, leaving selector tracing silent.
   */
  traceSelectors?: boolean | SelectorTracingOptions;
  /**
   * Creates a Store-owned logger subscription for this instance's trace streams.
   * The returned disposer is called when the Store is disposed.
   */
  loggerFactory?: StoreLoggerFactory;
};
export type NormalizedStoreOptions = {
  throttledSelectorFrequency: number;
  sagaMonitor: boolean;
  logReduxActions: boolean;
  traceSelectors: NormalizedSelectorTracingOptions;
  loggerFactory?: StoreLoggerFactory;
};
export type StoreReducerState<Reducer> = Reducer extends StoreReducerFunction<infer State> ? State : never;
export type StoreStateFromStateMap<TStateMap extends StoreStateMap> = {
  [Domain in keyof TStateMap]: TStateMap[Domain];
};
export type StoreStateFromReducers<Reducers extends ReducersMap> = {
  [Domain in keyof Reducers]: StoreReducerState<Reducers[Domain]>;
};
export type StoreState<TStore = unknown> = TStore extends { readonly state: infer State }
  ? State
  : TStore extends { getReducers(): infer Reducers }
  ? Reducers extends ReducersMap
    ? StoreStateFromReducers<Reducers>
    : Record<string, any>
  : Record<string, any>;

/**
 * StoreInstanceState is a readable alias for the selector state shape of a concrete Store instance.
 */
export type StoreInstanceState<TStore = unknown> = StoreState<TStore>;

export type PreloadedStoreState<TState = StoreState> = Partial<TState>;

type ReduxStore = ReduxStoreBase<StoreState, UnknownAction>;

// ============================================================================
// Selector Types
// ============================================================================

type ReadableValue<T> = {
  subscribe(run: (value: T) => void, invalidate?: (value?: T) => void): () => void;
};

/**
 * Framework-neutral compatibility contract for readable selector arguments.
 */
export type ReadableArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | ReadableValue<ARGS[K]>;
};

export type StoreSelectorCallback<R, ARGS extends any[] = [], TState = StoreState> = (
  state: TState,
  ...args: ARGS
) => R;

export type StoreSelectorReadable<R, ARGS extends any[] = []> = (
  ...args: ReadableArgs<ARGS>
) => ReadableValue<R>;

export type StoreSelectorSelect<R, ARGS extends any[] = [], TState = StoreState> = StoreSelectorCallback<R, ARGS, TState>;

export type StoreSelectorEffect<R, ARGS extends any[] = []> = (...args: ARGS) => SagaGenerator<R>;

type StoreSelectorWithStore<
  R,
  ARGS extends any[] = [],
  TStore extends StoreRuntime<any, any> = StoreRuntime<any, any>,
> = (
  store: TStore
) => StoreSelectorReadable<R, ARGS>;

export type StoreSelector<
  R,
  ARGS extends any[] = [],
  TState = StoreState,
  TStore extends StoreRuntime<any, any> = StoreRuntime<any, any>,
> = StoreSelectorReadable<R, ARGS> & {
  withStore: StoreSelectorWithStore<R, ARGS, TStore>;
  select: StoreSelectorSelect<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};

export type CreateSelector = <TStore extends StoreRuntime<any, any>, ARGS extends any[] = [], R = unknown>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, StoreState<TStore>>
) => StoreSelector<R, ARGS, StoreState<TStore>, TStore>;

