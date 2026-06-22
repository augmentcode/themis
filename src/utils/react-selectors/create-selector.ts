import { computed, type ReadonlySignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { select } from "typed-redux-saga";
import type { StoreSelectorCallback, StoreSelectorEffect, StoreState } from "../../types";
import type { Collection } from "../collections/collection-utils";
import {
  createCachedSelector,
  type SelectorTraceReporter,
} from "../selector-core/create-cached-selector";
import { areStoreUpdatesLocked } from "../selector-core/store-update-lock";
import {
  DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  resolveSelectorFlushManager,
  type SelectorFlushManagerSource,
} from "../selector-core/throttled-selector-options";
import { createThrottledSignal } from "./selector-scheduler";

export { createCachedSelector };

export type StoreSignalStateSource<TState = StoreState> = {
  getSignalState(): ReadonlySignal<TState>;
};

type SignalState<TStore> = TStore extends StoreSignalStateSource<infer TState> ? TState : StoreState<TStore>;

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

  return "getSignalState" in arg && typeof arg.getSignalState === "function";
};

const resolveSignalState = <TState>(
  store: StoreSignalStateSource<TState> | ReadonlySignal<TState>
): ReadonlySignal<TState> => {
  if (isSignal<TState>(store)) {
    return store;
  }

  return store.getSignalState();
};

const readSignalArg = <T>(arg: T | ReadonlySignal<T>): T => {
  if (isSignal<T>(arg)) {
    return arg.value;
  }

  return arg;
};

export const createSelectorFromSignalState = <TState = StoreState, ARGS extends any[] = [], R = unknown>(
  getSignalState: () => ReadonlySignal<TState>,
  selectorFunc: StoreSelectorCallback<R, ARGS, TState>,
  selectorFlushManagerOrFrequency: SelectorFlushManagerSource = DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  traceReporter?: SelectorTraceReporter<TState, R, ARGS>
): StoreReactSelector<R, ARGS, TState> => {
  const selectorFlushManager = typeof selectorFlushManagerOrFrequency === "function"
    ? undefined
    : resolveSelectorFlushManager(selectorFlushManagerOrFrequency);
  const getSelectorFlushManager = () =>
    selectorFlushManager ?? resolveSelectorFlushManager(selectorFlushManagerOrFrequency);
  const boundSelector = (
    signalStoreState: ReadonlySignal<TState>,
    ...restArgs: SignalArgs<ARGS>
  ): ReadonlySignal<R> => {
    const cachedSelector = createCachedSelector<TState, ARGS, R>(selectorFunc, {
      lockUpdatesPredicate: areStoreUpdatesLocked,
      traceReporter,
    });
    const selected = computed(() => {
      const args = restArgs.map(readSignalArg) as ARGS;
      return cachedSelector(signalStoreState.value, ...args);
    });

    return createThrottledSignal(selected, getSelectorFlushManager());
  };

  const signalSelector = ((...restArgs: SignalArgs<ARGS>) => {
    return boundSelector(getSignalState(), ...restArgs);
  }) as StoreReactSelector<R, ARGS, TState>;

  signalSelector.useValue = (...args: SignalArgs<ARGS>) => {
    useSignals();
    return signalSelector(...args).value;
  };
  signalSelector.withStore = (store: StoreSignalStateSource<TState> | ReadonlySignal<TState>) => {
    return (...args: SignalArgs<ARGS>) => boundSelector(resolveSignalState(store), ...args);
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

  return createSelectorFromSignalState(() => store.getSignalState(), selectorFunc);
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