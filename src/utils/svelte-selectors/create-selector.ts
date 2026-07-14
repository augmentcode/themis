import type {
  CreateSelector,
  StoreState,
  StoreReadableStateSource,
  StoreSelector,
  ReadableArgs,
  StoreSelectorCallback,
} from "../../types";
import type { Collection } from "../collections/collection-utils";
import { readable, derived, type Readable } from "svelte/store";
import { createThrottledReadable } from "./selector-scheduler";
import { select } from "typed-redux-saga";
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

export { createCachedSelector };

const isReadable = <T = any>(arg: unknown): arg is Readable<T> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "subscribe" in arg && typeof arg.subscribe === "function";
};

const isReadableStateSource = <TState = StoreState>(arg: unknown): arg is StoreReadableStateSource<TState> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "getStateObservable" in arg && typeof arg.getStateObservable === "function";
};

type StoreSelectorRuntimeSource<TState, R, ARGS extends unknown[]> = {
  getSelectorFlushManager?: () => SelectorFlushManager;
  getSelectorTraceReporter?: <STATE = TState, RESULT = R, SELECTOR_ARGS extends unknown[] = ARGS>() => SelectorTraceReporter<STATE, RESULT, SELECTOR_ARGS>;
  shouldTraceSelectorCache?: () => boolean;
};

const getStoreSelectorFlushManagerSource = <TState, R, ARGS extends unknown[]>(
  stateSource: StoreReadableStateSource<TState>
): SelectorFlushManagerSource | undefined => {
  const getSelectorFlushManager = (stateSource as StoreSelectorRuntimeSource<TState, R, ARGS>).getSelectorFlushManager;
  return typeof getSelectorFlushManager === "function"
    ? () => getSelectorFlushManager.call(stateSource)
    : undefined;
};

const getStoreSelectorTraceReporter = <TState, R, ARGS extends unknown[]>(
  stateSource: StoreReadableStateSource<TState>
): SelectorTraceReporter<TState, R, ARGS> | undefined => {
  const getSelectorTraceReporter = (stateSource as StoreSelectorRuntimeSource<TState, R, ARGS>).getSelectorTraceReporter;
  return typeof getSelectorTraceReporter === "function"
    ? getSelectorTraceReporter.call(stateSource) as SelectorTraceReporter<TState, R, ARGS>
    : undefined;
};

const getStoreSelectorCacheTracePredicate = <TState, R, ARGS extends unknown[]>(
  stateSource: StoreReadableStateSource<TState>
): (() => boolean) | undefined => {
  const shouldTraceSelectorCache = (stateSource as StoreSelectorRuntimeSource<TState, R, ARGS>).shouldTraceSelectorCache;
  return typeof shouldTraceSelectorCache === "function"
    ? () => shouldTraceSelectorCache.call(stateSource)
    : undefined;
};

export const createSelectorFromReadableState = <TState = StoreState, ARGS extends any[] = [], R = unknown>(
  store: StoreReadableStateSource<TState>,
  selectorFunc: StoreSelectorCallback<R, ARGS, TState>,
  selectorFlushManagerOrFrequency: SelectorFlushManagerSource = DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  traceReporter?: SelectorTraceReporter<TState, R, ARGS>,
  shouldTraceSelectorCache?: () => boolean
): StoreSelector<R, ARGS, TState> => {
  if (!isReadableStateSource(store)) {
    throw new TypeError("createSelectorFromReadableState requires a Store-like state source as the first argument.");
  }

  const effectiveSelectorFlushManagerOrFrequency =
    getStoreSelectorFlushManagerSource<TState, R, ARGS>(store) ?? selectorFlushManagerOrFrequency;
  const effectiveTraceReporter = traceReporter ?? getStoreSelectorTraceReporter<TState, R, ARGS>(store);
  const effectiveShouldTraceSelectorCache =
    shouldTraceSelectorCache ?? getStoreSelectorCacheTracePredicate<TState, R, ARGS>(store);
  const selectorFlushManager = typeof effectiveSelectorFlushManagerOrFrequency === "function"
    ? undefined
    : resolveSelectorFlushManager(effectiveSelectorFlushManagerOrFrequency);
  const getSelectorFlushManager = () =>
    selectorFlushManager ?? resolveSelectorFlushManager(effectiveSelectorFlushManagerOrFrequency);
  const boundSelector = (
    store: StoreReadableStateSource<TState>,
    ...restArgs: ReadableArgs<ARGS>
  ): Readable<R> => {
    const readableStoreState = store.getStateObservable();

    return getOrCreate(store, selectorFunc, restArgs, () => {
      const cachedSelector = createCachedSelector<TState, ARGS, R>(selectorFunc, {
        lockUpdatesPredicate: areStoreUpdatesLocked,
        traceReporter: effectiveTraceReporter,
      });
      const readableArgs = restArgs.map((arg) => {
        if (isReadable(arg)) {
          return arg;
        }
        return readable(arg);
      });
      const derivedStore = derived([readableStoreState, ...readableArgs], ([storeState, ...args]) => {
        return cachedSelector(storeState as TState, ...(args as ARGS));
      });
      return createThrottledReadable(derivedStore, getSelectorFlushManager());
    }, effectiveTraceReporter && effectiveShouldTraceSelectorCache?.() ? { traceReporter: effectiveTraceReporter } : undefined);
  };

  const readableSelector = ((...restArgs: ReadableArgs<ARGS>) => {
    return boundSelector(store, ...restArgs);
  }) as StoreSelector<R, ARGS, TState>;

  readableSelector.withStore =
    (store: StoreReadableStateSource<TState>) =>
    (...args: ReadableArgs<ARGS>) => {
      return boundSelector(store, ...args);
    };

  readableSelector.select = selectorFunc;
  readableSelector.effect = (...args: ARGS) => {
    return select(selectorFunc as StoreSelectorCallback<R, ARGS>, ...args);
  };

  return readableSelector;
};

const createSelectorImpl = <TStore extends StoreReadableStateSource<any>, ARGS extends any[] = [], R = unknown>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, StoreState<TStore>>
): StoreSelector<R, ARGS, StoreState<TStore>> => {
  if (!isReadableStateSource(store)) {
    throw new TypeError("createSelector requires a Store instance as the first argument.");
  }

  if (typeof selectorFunc !== "function") {
    throw new TypeError("createSelector requires a selector function as the second argument.");
  }

  return createSelectorFromReadableState(
    store,
    selectorFunc
  );
};

export const createSelector = createSelectorImpl as CreateSelector;

export const createCollectionItemSelector = <
  ITEM extends object,
  K extends keyof ITEM & string,
  TStore extends StoreReadableStateSource<any> = StoreReadableStateSource<StoreState>,
>(
  store: TStore,
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[], StoreState<TStore>>
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
  TStore extends StoreReadableStateSource<any> = StoreReadableStateSource<StoreState>,
>(
  store: TStore,
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[], StoreState<TStore>>,
  itemFilter?: F
) => {
  return createSelector(store, (state): ITEM[] => {
    const { map, ids } = collectionSelector(state);
    const list = ids.map((id) => map[id]);
    return itemFilter ? list.filter(itemFilter) : list;
  });
};
