import type {
  CreateSelector,
  StoreState,
  StoreReadableStateSource,
  StoreSelector,
  ReadableArgs,
  StoreSelectorCallback,
} from "../../types";
import type { ReduxStore } from "../../internal-types";
import type { Collection } from "../collections/collection-utils";
import { readable, derived, type Readable } from "svelte/store";
import { createStoreStateReadable } from "./create-readable-store-state";
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
  type SelectorFlushManagerSource,
} from "../selector-core/throttled-selector-options";

export { createCachedSelector };

const isReduxStore = (arg: unknown): arg is ReduxStore => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return (
    "dispatch" in arg &&
    typeof arg.dispatch === "function" &&
    "getState" in arg &&
    typeof arg.getState === "function" &&
    "subscribe" in arg &&
    typeof arg.subscribe === "function"
  );
};

const isReadable = <T = any>(arg: unknown): arg is Readable<T> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "subscribe" in arg && typeof arg.subscribe === "function" && !isReduxStore(arg);
};

const isReadableStateSource = <TState = StoreState>(arg: unknown): arg is StoreReadableStateSource<TState> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "getReadableState" in arg && typeof arg.getReadableState === "function";
};

const resolveReadableState = <TState>(
  stateSource: StoreReadableStateSource<TState> | ReduxStore | Readable<TState>
): Readable<TState> => {
  if (isReadable<TState>(stateSource)) {
    return stateSource;
  }

  if (isReadableStateSource<TState>(stateSource)) {
    return stateSource.getReadableState();
  }

  return createStoreStateReadable(stateSource) as Readable<TState>;
};

export const createSelectorFromReadableState = <TState = StoreState, ARGS extends any[] = [], R = unknown>(
  getReadableState: () => Readable<TState>,
  selectorFunc: StoreSelectorCallback<R, ARGS, TState>,
  selectorFlushManagerOrFrequency: SelectorFlushManagerSource = DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  traceReporter?: SelectorTraceReporter<TState, R, ARGS>,
  stateSource?: StoreReadableStateSource<TState> | ReduxStore | Readable<TState>
): StoreSelector<R, ARGS, TState> => {
  const selectorFlushManager = typeof selectorFlushManagerOrFrequency === "function"
    ? undefined
    : resolveSelectorFlushManager(selectorFlushManagerOrFrequency);
  const getSelectorFlushManager = () =>
    selectorFlushManager ?? resolveSelectorFlushManager(selectorFlushManagerOrFrequency);
  const boundSelector = (
    stateSource: StoreReadableStateSource<TState> | ReduxStore | Readable<TState>,
    ...restArgs: ReadableArgs<ARGS>
  ): Readable<R> => {
    const readableStoreState = resolveReadableState(stateSource);

    return getOrCreate(stateSource, selectorFunc, restArgs, () => {
      const cachedSelector = createCachedSelector<TState, ARGS, R>(selectorFunc, {
        lockUpdatesPredicate: areStoreUpdatesLocked,
        traceReporter,
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
    });
  };

  const readableSelector = ((...restArgs: ReadableArgs<ARGS>) => {
    return boundSelector(stateSource ?? getReadableState(), ...restArgs);
  }) as StoreSelector<R, ARGS, TState>;

  readableSelector.withStore =
    (store: StoreReadableStateSource<TState> | ReduxStore) =>
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
    () => store.getReadableState(),
    selectorFunc,
    DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
    undefined,
    store
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
