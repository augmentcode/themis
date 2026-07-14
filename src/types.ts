import type { Middleware, Store, UnknownAction } from 'redux';
import type { Readable } from 'svelte/store';
import type { SagaGenerator } from 'typed-redux-saga';

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
   * Enables diagnostic selector flush tracing.
   * Defaults to false, leaving selector tracing silent.
   */
  traceSelectors?: boolean;
};
export type NormalizedStoreOptions = {
  throttledSelectorFrequency: number;
  sagaMonitor: boolean;
  traceSelectors: boolean;
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
  : TStore extends { getStateObservable(): Readable<infer State> }
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

export type StoreReadableStateSource<TState = StoreState> = {
  getStateObservable(): Readable<TState>;
};

export type PreloadedStoreState<TState = StoreState> = Partial<TState>;

type ReduxStore = Store<StoreState, UnknownAction>;

// ============================================================================
// Selector Types
// ============================================================================

/**
 * Converts an args tuple so that each element can be either a plain value or a Readable.
 * Used by selectors to accept reactive arguments in Svelte components.
 */
export type ReadableArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | Readable<ARGS[K]>;
};

export type StoreSelectorCallback<R, ARGS extends any[] = [], TState = StoreState> = (
  state: TState,
  ...args: ARGS
) => R;

export type StoreSelectorReadable<R, ARGS extends any[] = []> = (
  ...args: ReadableArgs<ARGS>
) => Readable<R>;

export type StoreSelectorSelect<R, ARGS extends any[] = [], TState = StoreState> = StoreSelectorCallback<R, ARGS, TState>;

export type StoreSelectorEffect<R, ARGS extends any[] = []> = (...args: ARGS) => SagaGenerator<R>;

type StoreSelectorWithStore<R, ARGS extends any[] = [], TState = StoreState> = (
  store: StoreReadableStateSource<TState>
) => StoreSelectorReadable<R, ARGS>;

export type StoreSelector<R, ARGS extends any[] = [], TState = StoreState> = StoreSelectorReadable<R, ARGS> & {
  withStore: StoreSelectorWithStore<R, ARGS, TState>;
  select: StoreSelectorSelect<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};

export type CreateSelector = <TStore extends StoreReadableStateSource<any>, ARGS extends any[] = [], R = unknown>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, StoreState<TStore>>
) => StoreSelector<R, ARGS, StoreState<TStore>>;

