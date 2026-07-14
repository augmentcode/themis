import type { ReadonlySignal } from "@preact/signals-react";
import type { Observable, Property } from "kefir";
import type { UnknownAction } from "redux";
import type { ReactStore } from "../react-store";
import type { StreamingStore } from "../streaming-store";
import type {
  StoreAction,
  StoreActionCreator,
  StoreSelectorCallback,
  StoreSelectorEffect,
  StoreState,
} from "../types";

export type Collection<ITEM extends object, K extends string & keyof ITEM> = ITEM[K] extends string
  ? {
      idField: K & string;
      ids: Array<ITEM[K]>;
      map: Record<ITEM[K] & string, ITEM>;
      refsCount: Record<ITEM[K], number>;
    }
  : never;

export type RefsCounter<
  ITEM extends object,
  K extends ITEM[K] extends string ? keyof ITEM : never,
> = ITEM[K] extends string ? Record<ITEM[K], ITEM> : never;

export type SignalArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | ReadonlySignal<ARGS[K]>;
};

export type StoreReactSelector<
  R,
  ARGS extends any[] = [],
  TState = StoreState,
  TStore extends ReactStore<any, any> = ReactStore<any, any>,
> = ((...args: SignalArgs<ARGS>) => ReadonlySignal<R>) & {
  useValue: (...args: SignalArgs<ARGS>) => R;
  withStore: (store: TStore) => (...args: SignalArgs<ARGS>) => ReadonlySignal<R>;
  select: StoreSelectorCallback<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};

export type StreamingArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | Observable<ARGS[K], any>;
};

export type StoreStreamingSelector<
  R,
  ARGS extends any[] = [],
  TState = StoreState,
  TStore extends StreamingStore<any, any> = StreamingStore<any, any>,
> = ((...args: StreamingArgs<ARGS>) => Observable<R, any>) & {
  withStore: (store: TStore) => (...args: StreamingArgs<ARGS>) => Observable<R, any>;
  select: StoreSelectorCallback<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};

export type AccessedPath = (string | symbol)[];

export type CachedSelector<STATE, R, ARGS extends unknown[] = []> = (
  state: STATE,
  ...args: ARGS
) => R;

export type SelectorAccessTrace<STATE, R, ARGS extends unknown[] = []> = {
  selectorFunc: CachedSelector<STATE, R, ARGS>;
  accessedPathCount: number;
  accessedPaths: Set<string>;
  parsedPaths: Map<string, AccessedPath>;
};

export type SelectorOutputCacheTrace<STATE, R, ARGS extends unknown[] = []> = {
  selectorFunc: CachedSelector<STATE, R, ARGS>;
  observableCacheRequestCount: number;
  observableCacheCachedCount: number;
};

export type SelectorTrace<STATE, R, ARGS extends unknown[] = []> =
  | SelectorAccessTrace<STATE, R, ARGS>
  | SelectorOutputCacheTrace<STATE, R, ARGS>;

export type SelectorTraceReporter<STATE, R, ARGS extends unknown[] = []> = (
  trace: SelectorTrace<STATE, R, ARGS>
) => void;

export type CreateCachedSelectorOptions<STATE, R = unknown, ARGS extends unknown[] = []> = {
  lockUpdatesPredicate?: (state: STATE) => boolean;
  traceReporter?: SelectorTraceReporter<STATE, R, ARGS>;
};

export type SelectorCadenceTickListener = (timestamp: number) => void;

export type SelectorCadenceSource = {
  readonly frequency: number;
  readonly frameIntervalMs: number;
  getSnapshot(): number;
  requestTick(): void;
  subscribe(listener: SelectorCadenceTickListener): () => void;
  dispose(): void;
};

export type SelectorCadenceSourceOptions = {
  traceSelectors?: boolean;
};

export type SelectorCadenceSourceProvider = () => SelectorCadenceSource;

export type SelectorCadenceSourceSource = SelectorCadenceSource | SelectorCadenceSourceProvider | number;

export type SelectorOutputCacheKey = (...args: any[]) => unknown;

export type SelectorOutputFactory<OUTPUT> = () => OUTPUT;

export type SelectorOutputCacheOptions = {
  traceReporter?: SelectorTraceReporter<any, any, any[]>;
};

export type KefirSelectorProperty<T> = {
  property: Property<T, any>;
  getSnapshot: () => T;
};

export type SelectorChannelSelector<R, ARGS extends any[] = [], TState = StoreState> = {
  select: StoreSelectorCallback<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};

export type SelectorChannelPayload<R> = {
  payload: R;
  prevPayload: R | undefined | null;
};

export type SelectorWorkerSaga<R> = (payload: SelectorChannelPayload<R>) => Generator<any, void, any>;

export type RetryWithTimeoutOutcome = "success" | "retries-exhausted" | "timeout";

export interface RetryWithTimeoutOptions {
  maxRetries: number;
  timeoutMs: number;
  getDelayMs?: (attempt: number) => number;
  onAttemptError?: (error: unknown, attempt: number, totalAttempts: number) => void;
}

export interface WrapStreamingGeneratorOptions {
  timeoutMs?: number;
  onError?: (error: unknown) => void;
}

export type BooleanPreferenceReducerBuilder<S> = {
  (state: S | undefined, action: StoreAction<any> | UnknownAction): S;
  with<ARGS extends any[], PL = ARGS>(
    action: StoreActionCreator<ARGS, PL>,
    reducer: (state: S, action: StoreAction<PL>) => S
  ): BooleanPreferenceReducerBuilder<S>;
  initialState: S;
};

export type StoreReducer<S, A> = (state: S, action: A) => S;