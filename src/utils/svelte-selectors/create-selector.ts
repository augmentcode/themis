import type {
  StoreState,
  StoreSelectorCallback,
} from "../../types";
import { StoreRuntime } from "../../store-runtime";
import type { Store } from "../../svelte-store";
import { readable, get, type Readable } from "svelte/store";
import type { Observable } from "kefir";
import { select } from "typed-redux-saga";
import { createCachedSelector } from "../selector-core/create-cached-selector";
import { getOrCreate } from "../selector-core/selector-output-cache";
import {
  getSelectorCacheTraceReporter,
  getSelectorComputationTraceOptions,
} from "../selector-core/selector-tracing-bridge";
import {
  createConstantKefirProperty,
  createKefirPropertyFromSubscribe,
  createKefirSelectorProperty,
} from "../selector-core/kefir-selector";
import type { KefirSelectorProperty } from "../types";
import type { SvelteReadableArgs, SvelteStoreSelector } from "./types";

export { createCachedSelector };
export type { SvelteReadableArgs, SvelteStoreSelector } from "./types";

const isReadable = <T = any>(arg: unknown): arg is Readable<T> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "subscribe" in arg && typeof arg.subscribe === "function";
};

const readableArgToKefirProperty = <T>(arg: T | Readable<T>): Observable<T, any> => {
  if (isReadable<T>(arg)) {
    return createKefirPropertyFromSubscribe(() => get(arg), (listener) => arg.subscribe(listener));
  }

  return createConstantKefirProperty(arg);
};

const readReadableArg = <T>(arg: T | Readable<T>): T => {
  if (isReadable<T>(arg)) {
    return get(arg);
  }

  return arg;
};

type SvelteState<TStore> = StoreState<TStore>;

const kefirSelectorPropertyToReadable = <R>(
  selected: KefirSelectorProperty<R>
): Readable<R> => {
  let currentValue = selected.getSnapshot();

  return readable(currentValue, (set) => {
    const setIfChanged = (value: R) => {
      if (value !== currentValue) {
        currentValue = value;
        set(value);
      }
    };
    setIfChanged(selected.getSnapshot());
    const subscription = selected.property.observe(setIfChanged);

    return () => {
      subscription.unsubscribe();
    };
  });
};

const isStoreRuntime = (arg: unknown): arg is StoreRuntime<any, any> => arg instanceof StoreRuntime;

export const createSelector = <TStore extends Store<any, any>, ARGS extends any[] = [], R = unknown>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, SvelteState<TStore>>
): SvelteStoreSelector<R, ARGS, SvelteState<TStore>, TStore> => {
  if (!isStoreRuntime(store)) {
    throw new TypeError("createSelector requires a Store-like state source as the first argument.");
  }

  const boundSelector = (
    store: TStore,
    ...restArgs: SvelteReadableArgs<ARGS>
  ): Readable<R> => {
    const traceOptions = getSelectorComputationTraceOptions<SvelteState<TStore>, R, ARGS>(store);
    const traceCacheReporter = getSelectorCacheTraceReporter<SvelteState<TStore>, R, ARGS>(store);

    return getOrCreate(store, selectorFunc, restArgs, () => {
      const argProperties = restArgs.map(readableArgToKefirProperty);
      const selected = createKefirSelectorProperty<TStore, ARGS, R>(
        store,
        selectorFunc,
        argProperties,
        () => restArgs.map(readReadableArg) as ARGS,
        traceOptions
      );
      return kefirSelectorPropertyToReadable(selected);
    }, traceCacheReporter ? { traceReporter: traceCacheReporter } : undefined);
  };

  const readableSelector = ((...restArgs: SvelteReadableArgs<ARGS>) => {
    return boundSelector(store, ...restArgs);
  }) as SvelteStoreSelector<R, ARGS, SvelteState<TStore>, TStore>;

  readableSelector.withStore =
    (store: TStore) =>
    (...args: SvelteReadableArgs<ARGS>) => {
      return boundSelector(store, ...args);
    };

  readableSelector.select = selectorFunc;
  readableSelector.effect = (...args: ARGS) => {
    return select(selectorFunc as StoreSelectorCallback<R, ARGS>, ...args);
  };

  return readableSelector;
};
