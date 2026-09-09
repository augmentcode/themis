import type { Observable } from "kefir";
import { select } from "typed-redux-saga";
import { StoreRuntime } from "../../store-runtime";
import type { StreamingStore } from "../../streaming-store";
import type { StoreSelectorCallback, StoreState } from "../../types";
import type { StreamingArgs, StoreStreamingSelector } from "./types";
import { createCachedSelector } from "../selector-core/create-cached-selector";
import { getOrCreate } from "../selector-core/selector-output-cache";
import {
  getSelectorCacheTraceReporter,
  getSelectorComputationTraceOptions,
} from "../selector-core/selector-tracing-bridge";
import {
  createConstantKefirProperty,
  createKefirSelectorProperty,
  isKefirObservable,
} from "../selector-core/kefir-selector";

export { createCachedSelector };
export type { StreamingArgs, StoreStreamingSelector } from "./types";

type StreamingState<TStore> = StoreState<TStore>;

const isStoreRuntime = (arg: unknown): arg is StoreRuntime<any, any> => arg instanceof StoreRuntime;

const toKefirObservable = <T>(arg: T | Observable<T, any>): Observable<T, any> => {
  if (isKefirObservable<T>(arg)) {
    return arg;
  }

  return createConstantKefirProperty(arg);
};

const hasObservableArgs = (args: unknown[]): boolean => args.some(isKefirObservable);

export const createSelector = <TStore extends StreamingStore<any, any>, ARGS extends any[] = [], R = unknown>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, StreamingState<TStore>>
): StoreStreamingSelector<R, ARGS, StreamingState<TStore>, TStore> => {
  if (!isStoreRuntime(store)) {
    throw new TypeError("createSelector requires a Store-like state source as the first argument.");
  }

  const boundSelector = (
    store: TStore,
    ...restArgs: StreamingArgs<ARGS>
  ): Observable<R, any> => {
    const traceOptions = getSelectorComputationTraceOptions<StreamingState<TStore>, R, ARGS>(store);
    const traceCacheReporter = getSelectorCacheTraceReporter<StreamingState<TStore>, R, ARGS>(store);

    const output = getOrCreate(store, selectorFunc, restArgs, (releaseInactiveOutput) => {
      const hasObservableSelectorArgs = hasObservableArgs(restArgs);
      const selected = createKefirSelectorProperty<TStore, ARGS, R>(
        store,
        selectorFunc,
        restArgs.map(toKefirObservable),
        hasObservableSelectorArgs ? undefined : () => restArgs as ARGS,
        traceOptions,
        releaseInactiveOutput
      );
      return selected.property;
    }, traceCacheReporter ? { traceReporter: traceCacheReporter } : undefined);
    return output;
  };

  const streamSelector = ((...restArgs: StreamingArgs<ARGS>) => {
    return boundSelector(store, ...restArgs);
  }) as StoreStreamingSelector<R, ARGS, StreamingState<TStore>, TStore>;

  streamSelector.withStore = (store: TStore) => {
    return (...args: StreamingArgs<ARGS>) => boundSelector(store, ...args);
  };
  streamSelector.select = selectorFunc;
  streamSelector.effect = (...args: ARGS) => {
    return select(selectorFunc as StoreSelectorCallback<R, ARGS>, ...args);
  };

  return streamSelector;
};
