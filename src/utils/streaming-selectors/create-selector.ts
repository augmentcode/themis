import Kefir, { type Observable } from "kefir";
import { select } from "typed-redux-saga";
import type { StoreSelectorCallback, StoreSelectorEffect, StoreState } from "../../types";
import type { Collection } from "../collections/collection-utils";
import {
  createCachedSelector,
  type SelectorTraceReporter,
} from "../selector-core/create-cached-selector";
import { getOrCreate } from "../selector-core/selector-output-cache";
import { areStoreUpdatesLocked } from "../selector-core/store-update-lock";
import {
  DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  resolveSelectorFlushManager,
  type SelectorFlushManager,
  type SelectorFlushManagerSource,
} from "../selector-core/throttled-selector-options";
import { createThrottledObservable } from "./selector-scheduler";

export { createCachedSelector };

export type StoreStreamingStateSource<TState = StoreState> = {
  getStreamState(): Observable<TState, any>;
};

type StreamingState<TStore> = TStore extends StoreStreamingStateSource<infer TState> ? TState : StoreState<TStore>;

type StoreSelectorRuntimeSource<TState, R, ARGS extends unknown[]> = {
  getSelectorFlushManager?: () => SelectorFlushManager;
  getSelectorTraceReporter?: <STATE = TState, RESULT = R, SELECTOR_ARGS extends unknown[] = ARGS>() => SelectorTraceReporter<STATE, RESULT, SELECTOR_ARGS>;
  shouldTraceSelectorCache?: () => boolean;
};

export type StreamingArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | Observable<ARGS[K], any>;
};

export type StoreStreamingSelector<R, ARGS extends any[] = [], TState = StoreState> = ((
  ...args: StreamingArgs<ARGS>
) => Observable<R, any>) & {
  withStore: (store: StoreStreamingStateSource<TState> | Observable<TState, any>) => (
    ...args: StreamingArgs<ARGS>
  ) => Observable<R, any>;
  select: StoreSelectorCallback<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};

export type CreateStreamingSelector = <
  TStore extends StoreStreamingStateSource<any>,
  ARGS extends any[] = [],
  R = unknown,
>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, StreamingState<TStore>>
) => StoreStreamingSelector<R, ARGS, StreamingState<TStore>>;

const isKefirObservable = <T = any>(arg: unknown): arg is Observable<T, any> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "observe" in arg && typeof arg.observe === "function";
};

const isStreamingStateSource = <TState = StoreState>(arg: unknown): arg is StoreStreamingStateSource<TState> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "getStreamState" in arg && typeof arg.getStreamState === "function";
};

const getStoreSelectorFlushManagerSource = <TState, R, ARGS extends unknown[]>(
  stateSource: StoreStreamingStateSource<TState> | Observable<TState, any>
): SelectorFlushManagerSource | undefined => {
  const getSelectorFlushManager = (stateSource as StoreSelectorRuntimeSource<TState, R, ARGS>).getSelectorFlushManager;
  return typeof getSelectorFlushManager === "function"
    ? () => getSelectorFlushManager.call(stateSource)
    : undefined;
};

const getStoreSelectorTraceReporter = <TState, R, ARGS extends unknown[]>(
  stateSource: StoreStreamingStateSource<TState> | Observable<TState, any>
): SelectorTraceReporter<TState, R, ARGS> | undefined => {
  const getSelectorTraceReporter = (stateSource as StoreSelectorRuntimeSource<TState, R, ARGS>).getSelectorTraceReporter;
  return typeof getSelectorTraceReporter === "function"
    ? getSelectorTraceReporter.call(stateSource) as SelectorTraceReporter<TState, R, ARGS>
    : undefined;
};

const getStoreSelectorCacheTracePredicate = <TState, R, ARGS extends unknown[]>(
  stateSource: StoreStreamingStateSource<TState> | Observable<TState, any>
): (() => boolean) | undefined => {
  const shouldTraceSelectorCache = (stateSource as StoreSelectorRuntimeSource<TState, R, ARGS>).shouldTraceSelectorCache;
  return typeof shouldTraceSelectorCache === "function"
    ? () => shouldTraceSelectorCache.call(stateSource)
    : undefined;
};

const toKefirObservable = <T>(arg: T | Observable<T, any>): Observable<T, any> => {
  if (isKefirObservable<T>(arg)) {
    return arg;
  }

  return Kefir.constant(arg);
};

const resolveStreamState = <TState>(
  store: StoreStreamingStateSource<TState> | Observable<TState, any>
): Observable<TState, any> => {
  if (isKefirObservable<TState>(store)) {
    return store;
  }

  return store.getStreamState();
};

type StreamingStateSource<TState> = StoreStreamingStateSource<TState> | Observable<TState, any>;

export const createSelectorFromStreamState = <TState = StoreState, ARGS extends any[] = [], R = unknown>(
  stateSourceOrGetStreamState: StreamingStateSource<TState> | (() => Observable<TState, any>),
  selectorFunc: StoreSelectorCallback<R, ARGS, TState>,
  selectorFlushManagerOrFrequency: SelectorFlushManagerSource = DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  traceReporter?: SelectorTraceReporter<TState, R, ARGS>,
  stateSource?: StreamingStateSource<TState>,
  shouldTraceSelectorCache?: () => boolean
): StoreStreamingSelector<R, ARGS, TState> => {
  const sourceBoundSelector = typeof stateSourceOrGetStreamState === "function" ? undefined : stateSourceOrGetStreamState;
  const getStreamState = typeof stateSourceOrGetStreamState === "function"
    ? stateSourceOrGetStreamState
    : () => resolveStreamState(stateSourceOrGetStreamState);
  const defaultStateSource = sourceBoundSelector ?? stateSource;
  const effectiveSelectorFlushManagerOrFrequency = defaultStateSource
    ? getStoreSelectorFlushManagerSource<TState, R, ARGS>(defaultStateSource) ?? selectorFlushManagerOrFrequency
    : selectorFlushManagerOrFrequency;
  const effectiveTraceReporter = traceReporter ?? (defaultStateSource
    ? getStoreSelectorTraceReporter<TState, R, ARGS>(defaultStateSource)
    : undefined);
  const effectiveShouldTraceSelectorCache = shouldTraceSelectorCache ?? (defaultStateSource
    ? getStoreSelectorCacheTracePredicate<TState, R, ARGS>(defaultStateSource)
    : undefined);
  const selectorFlushManager = typeof effectiveSelectorFlushManagerOrFrequency === "function"
    ? undefined
    : resolveSelectorFlushManager(effectiveSelectorFlushManagerOrFrequency);
  const getSelectorFlushManager = () =>
    selectorFlushManager ?? resolveSelectorFlushManager(effectiveSelectorFlushManagerOrFrequency);
  const boundSelector = (
    stateSource: StreamingStateSource<TState>,
    ...restArgs: StreamingArgs<ARGS>
  ): Observable<R, any> => {
    const streamStoreState = resolveStreamState(stateSource);

    return getOrCreate(streamStoreState, selectorFunc, restArgs, () => {
      const cachedSelector = createCachedSelector<TState, ARGS, R>(selectorFunc, {
        lockUpdatesPredicate: areStoreUpdatesLocked,
        traceReporter: effectiveTraceReporter,
      });
      const streamArgs = restArgs.map(toKefirObservable);
      const combinedArgs = [streamStoreState, ...streamArgs] as Array<Observable<any, any>>;

      const combined = Kefir.combine(combinedArgs as any) as Observable<any[], any>;

      const selected = combined.map(([storeState, ...args]) => {
        return cachedSelector(storeState as TState, ...(args as ARGS));
      });

      return createThrottledObservable(selected, getSelectorFlushManager()).toProperty();
    }, effectiveTraceReporter && effectiveShouldTraceSelectorCache?.() ? { traceReporter: effectiveTraceReporter } : undefined);
  };

  const streamSelector = ((...restArgs: StreamingArgs<ARGS>) => {
    return boundSelector(defaultStateSource ?? getStreamState(), ...restArgs);
  }) as StoreStreamingSelector<R, ARGS, TState>;

  streamSelector.withStore = (store: StoreStreamingStateSource<TState> | Observable<TState, any>) => {
    return (...args: StreamingArgs<ARGS>) => boundSelector(store, ...args);
  };
  streamSelector.select = selectorFunc;
  streamSelector.effect = (...args: ARGS) => {
    return select(selectorFunc as StoreSelectorCallback<R, ARGS>, ...args);
  };

  return streamSelector;
};

const createSelectorImpl = <TStore extends StoreStreamingStateSource<any>, ARGS extends any[] = [], R = unknown>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, StreamingState<TStore>>
): StoreStreamingSelector<R, ARGS, StreamingState<TStore>> => {
  if (!isStreamingStateSource(store)) {
    throw new TypeError("createSelector requires a streaming state source as the first argument.");
  }

  if (typeof selectorFunc !== "function") {
    throw new TypeError("createSelector requires a selector function as the second argument.");
  }

  return createSelectorFromStreamState(
    store,
    selectorFunc
  );
};

export const createSelector = createSelectorImpl as CreateStreamingSelector;

export const createCollectionItemSelector = <
  ITEM extends object,
  K extends keyof ITEM & string,
  TStore extends StoreStreamingStateSource<any> = StoreStreamingStateSource<StoreState>,
>(
  store: TStore,
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[], StreamingState<TStore>>
) => {
  return createSelector(
    store,
    (state, itemId: ITEM[K] & string): ITEM | undefined => {
      if (!itemId) return undefined;
      const collection = collectionSelector(state);
      return collection.map[itemId];
    }
  );
};

export const createCollectionItemsListSelector = <
  ITEM extends object,
  K extends keyof ITEM & string,
  F extends (...args: any) => boolean,
  TStore extends StoreStreamingStateSource<any> = StoreStreamingStateSource<StoreState>,
>(
  store: TStore,
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[], StreamingState<TStore>>,
  itemFilter?: F
) => {
  return createSelector(store, (state): ITEM[] => {
    const { map, ids } = collectionSelector(state);
    const list = ids.map((id) => map[id]);
    return itemFilter ? list.filter(itemFilter) : list;
  });
};
