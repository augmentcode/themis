import { computed, type ReadonlySignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
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
import { createThrottledSignal } from "./selector-scheduler";

export { createCachedSelector };

export type StoreSignalStateSource<TState = StoreState> = {
  getStateObservable(): ReadonlySignal<TState>;
};

type SignalState<TStore> = TStore extends StoreSignalStateSource<infer TState> ? TState : StoreState<TStore>;

type StoreSelectorRuntimeSource<TState, R, ARGS extends unknown[]> = {
  getSelectorFlushManager?: () => SelectorFlushManager;
  getSelectorTraceReporter?: <STATE = TState, RESULT = R, SELECTOR_ARGS extends unknown[] = ARGS>() => SelectorTraceReporter<STATE, RESULT, SELECTOR_ARGS>;
  shouldTraceSelectorCache?: () => boolean;
};

export type SignalArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | ReadonlySignal<ARGS[K]>;
};

export type StoreReactSelector<R, ARGS extends any[] = [], TState = StoreState> = ((
  ...args: SignalArgs<ARGS>
) => ReadonlySignal<R>) & {
  useValue: (...args: SignalArgs<ARGS>) => R;
  withStore: (store: StoreSignalStateSource<TState> | ReadonlySignal<TState>) => (
    ...args: SignalArgs<ARGS>
  ) => ReadonlySignal<R>;
  select: StoreSelectorCallback<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};

export type CreateReactSelector = <
  TStore extends StoreSignalStateSource<any>,
  ARGS extends any[] = [],
  R = unknown,
>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, SignalState<TStore>>
) => StoreReactSelector<R, ARGS, SignalState<TStore>>;

const isSignal = <T = any>(arg: unknown): arg is ReadonlySignal<T> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "subscribe" in arg && typeof arg.subscribe === "function" && "value" in arg;
};

const isSignalStateSource = <TState = StoreState>(arg: unknown): arg is StoreSignalStateSource<TState> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "getStateObservable" in arg && typeof arg.getStateObservable === "function";
};

const getStoreSelectorFlushManagerSource = <TState, R, ARGS extends unknown[]>(
  stateSource: StoreSignalStateSource<TState> | ReadonlySignal<TState>
): SelectorFlushManagerSource | undefined => {
  const getSelectorFlushManager = (stateSource as StoreSelectorRuntimeSource<TState, R, ARGS>).getSelectorFlushManager;
  return typeof getSelectorFlushManager === "function"
    ? () => getSelectorFlushManager.call(stateSource)
    : undefined;
};

const getStoreSelectorTraceReporter = <TState, R, ARGS extends unknown[]>(
  stateSource: StoreSignalStateSource<TState> | ReadonlySignal<TState>
): SelectorTraceReporter<TState, R, ARGS> | undefined => {
  const getSelectorTraceReporter = (stateSource as StoreSelectorRuntimeSource<TState, R, ARGS>).getSelectorTraceReporter;
  return typeof getSelectorTraceReporter === "function"
    ? getSelectorTraceReporter.call(stateSource) as SelectorTraceReporter<TState, R, ARGS>
    : undefined;
};

const getStoreSelectorCacheTracePredicate = <TState, R, ARGS extends unknown[]>(
  stateSource: StoreSignalStateSource<TState> | ReadonlySignal<TState>
): (() => boolean) | undefined => {
  const shouldTraceSelectorCache = (stateSource as StoreSelectorRuntimeSource<TState, R, ARGS>).shouldTraceSelectorCache;
  return typeof shouldTraceSelectorCache === "function"
    ? () => shouldTraceSelectorCache.call(stateSource)
    : undefined;
};

const readSignalArg = <T>(arg: T | ReadonlySignal<T>): T => {
  if (isSignal<T>(arg)) {
    return arg.value;
  }

  return arg;
};

const resolveSignalState = <TState>(
  stateSource: StoreSignalStateSource<TState> | ReadonlySignal<TState>
): ReadonlySignal<TState> => {
  if (isSignal<TState>(stateSource)) {
    return stateSource;
  }

  return stateSource.getStateObservable();
};

export const createSelectorFromSignalState = <TState = StoreState, ARGS extends any[] = [], R = unknown>(
  stateSourceOrGetStateObservable: StoreSignalStateSource<TState> | (() => ReadonlySignal<TState>),
  selectorFunc: StoreSelectorCallback<R, ARGS, TState>,
  selectorFlushManagerOrFrequency: SelectorFlushManagerSource = DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  traceReporter?: SelectorTraceReporter<TState, R, ARGS>,
  stateSource?: StoreSignalStateSource<TState> | ReadonlySignal<TState>,
  shouldTraceSelectorCache?: () => boolean
): StoreReactSelector<R, ARGS, TState> => {
  const sourceBoundSelector = typeof stateSourceOrGetStateObservable === "function" ? undefined : stateSourceOrGetStateObservable;
  const getStateObservable = typeof stateSourceOrGetStateObservable === "function"
    ? stateSourceOrGetStateObservable
    : () => resolveSignalState(stateSourceOrGetStateObservable);
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
    stateSource: StoreSignalStateSource<TState> | ReadonlySignal<TState>,
    ...restArgs: SignalArgs<ARGS>
  ): ReadonlySignal<R> => {
    const signalState = resolveSignalState(stateSource);

    return getOrCreate(stateSource, selectorFunc, restArgs, () => {
      const cachedSelector = createCachedSelector<TState, ARGS, R>(selectorFunc, {
        lockUpdatesPredicate: areStoreUpdatesLocked,
        traceReporter: effectiveTraceReporter,
      });
      const selected = computed(() => {
        const args = restArgs.map(readSignalArg) as ARGS;
        return cachedSelector(signalState.value, ...args);
      });

      return createThrottledSignal(selected, getSelectorFlushManager());
    }, effectiveTraceReporter && effectiveShouldTraceSelectorCache?.() ? { traceReporter: effectiveTraceReporter } : undefined);
  };

  const signalSelector = ((...restArgs: SignalArgs<ARGS>) => {
    return boundSelector(defaultStateSource ?? getStateObservable(), ...restArgs);
  }) as StoreReactSelector<R, ARGS, TState>;

  signalSelector.useValue = (...args: SignalArgs<ARGS>) => {
    useSignals();
    return signalSelector(...args).value;
  };
  signalSelector.withStore = (store: StoreSignalStateSource<TState> | ReadonlySignal<TState>) => {
    return (...args: SignalArgs<ARGS>) => boundSelector(store, ...args);
  };
  signalSelector.select = selectorFunc;
  signalSelector.effect = (...args: ARGS) => {
    return select(selectorFunc as StoreSelectorCallback<R, ARGS>, ...args);
  };

  return signalSelector;
};

const createSelectorImpl = <TStore extends StoreSignalStateSource<any>, ARGS extends any[] = [], R = unknown>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, SignalState<TStore>>
): StoreReactSelector<R, ARGS, SignalState<TStore>> => {
  if (!isSignalStateSource(store)) {
    throw new TypeError("createSelector requires a signal state source as the first argument.");
  }

  if (typeof selectorFunc !== "function") {
    throw new TypeError("createSelector requires a selector function as the second argument.");
  }

  return createSelectorFromSignalState(
    store,
    selectorFunc
  );
};

export const createSelector = createSelectorImpl as CreateReactSelector;

export const createCollectionItemSelector = <
  ITEM extends object,
  K extends keyof ITEM & string,
  TStore extends StoreSignalStateSource<any> = StoreSignalStateSource<StoreState>,
>(
  store: TStore,
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[], SignalState<TStore>>
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
  TStore extends StoreSignalStateSource<any> = StoreSignalStateSource<StoreState>,
>(
  store: TStore,
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[], SignalState<TStore>>,
  itemFilter?: F
) => {
  return createSelector(store, (state): ITEM[] => {
    const { map, ids } = collectionSelector(state);
    const list = ids.map((id) => map[id]);
    return itemFilter ? list.filter(itemFilter) : list;
  });
};
