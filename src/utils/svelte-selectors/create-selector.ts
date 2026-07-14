import type {
  StoreState,
  StoreSelector,
  ReadableArgs,
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
  createConstantKefirProperty,
  createKefirPropertyFromSubscribe,
  createKefirSelectorProperty,
  type KefirSelectorProperty,
} from "../selector-core/kefir-selector";

export { createCachedSelector };

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

export type CreateSvelteSelector = <
  TStore extends Store<any, any>,
  ARGS extends any[] = [],
  R = unknown,
>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, SvelteState<TStore>>
) => StoreSelector<R, ARGS, SvelteState<TStore>, TStore>;

const kefirSelectorPropertyToReadable = <R>(
  selected: KefirSelectorProperty<R>
): Readable<R> => {
  return readable(selected.getSnapshot(), (set) => {
    set(selected.getSnapshot());
    const subscription = selected.property.observe((value) => set(value));

    return () => {
      subscription.unsubscribe();
    };
  });
};

const isStoreRuntime = (arg: unknown): arg is StoreRuntime<any, any> => arg instanceof StoreRuntime;

export const createSelectorFromReadableState = <TStore extends Store<any, any>, ARGS extends any[] = [], R = unknown>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, SvelteState<TStore>>
): StoreSelector<R, ARGS, SvelteState<TStore>, TStore> => {
  if (!isStoreRuntime(store)) {
    throw new TypeError("createSelectorFromReadableState requires a Store-like state source as the first argument.");
  }

  const boundSelector = (
    store: TStore,
    ...restArgs: ReadableArgs<ARGS>
  ): Readable<R> => {
    const traceReporter = store.getSelectorTraceReporter<SvelteState<TStore>, R, ARGS>();

    return getOrCreate(store, selectorFunc, restArgs, () => {
      const argProperties = restArgs.map(readableArgToKefirProperty);
      const selected = createKefirSelectorProperty<TStore, ARGS, R>(
        store,
        selectorFunc,
        argProperties,
        () => restArgs.map(readReadableArg) as ARGS,
        traceReporter
      );
      return kefirSelectorPropertyToReadable(selected);
    }, store.shouldTraceSelectorCache() ? { traceReporter } : undefined);
  };

  const readableSelector = ((...restArgs: ReadableArgs<ARGS>) => {
    return boundSelector(store, ...restArgs);
  }) as StoreSelector<R, ARGS, SvelteState<TStore>, TStore>;

  readableSelector.withStore =
    (store: TStore) =>
    (...args: ReadableArgs<ARGS>) => {
      return boundSelector(store, ...args);
    };

  readableSelector.select = selectorFunc;
  readableSelector.effect = (...args: ARGS) => {
    return select(selectorFunc as StoreSelectorCallback<R, ARGS>, ...args);
  };

  return readableSelector;
};

export const createSelector = createSelectorFromReadableState as CreateSvelteSelector;
