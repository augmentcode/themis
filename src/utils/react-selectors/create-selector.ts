import { signal, type ReadonlySignal, type Signal } from "@preact/signals-react";
import type { Observable, Subscription } from "kefir";
import { useSignals } from "@preact/signals-react/runtime";
import { select } from "typed-redux-saga";
import { StoreRuntime } from "../../store-runtime";
import type { ReactStore } from "../../react-store";
import type { StoreSelectorCallback, StoreSelectorEffect, StoreState } from "../../types";
import {
  createCachedSelector,
  type SelectorTraceReporter,
} from "../selector-core/create-cached-selector";
import { getOrCreate } from "../selector-core/selector-output-cache";
import {
  createConstantKefirProperty,
  createKefirPropertyFromSubscribe,
  createKefirSelectorProperty,
  type KefirSelectorProperty,
} from "../selector-core/kefir-selector";
import {
  DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  type SelectorCadenceSourceSource,
} from "../selector-core/throttled-selector-options";

export { createCachedSelector };

type SignalState<TStore> = StoreState<TStore>;

export type SignalArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | ReadonlySignal<ARGS[K]>;
};

export type StoreReactSelector<
  R,
  ARGS extends any[] = [],
  TState = StoreState,
  TStore extends ReactStore<any, any> = ReactStore<any, any>,
> = ((
  ...args: SignalArgs<ARGS>
) => ReadonlySignal<R>) & {
  useValue: (...args: SignalArgs<ARGS>) => R;
  withStore: (store: TStore) => (
    ...args: SignalArgs<ARGS>
  ) => ReadonlySignal<R>;
  select: StoreSelectorCallback<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};

export type CreateReactSelector = <
  TStore extends ReactStore<any, any>,
  ARGS extends any[] = [],
  R = unknown,
>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, SignalState<TStore>>
) => StoreReactSelector<R, ARGS, SignalState<TStore>, TStore>;

const isSignal = <T = any>(arg: unknown): arg is ReadonlySignal<T> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "subscribe" in arg && typeof arg.subscribe === "function" && "value" in arg;
};

const isStoreRuntime = (arg: unknown): arg is StoreRuntime<any, any> => arg instanceof StoreRuntime;

const readSignalArg = <T>(arg: T | ReadonlySignal<T>): T => {
  if (isSignal<T>(arg)) {
    return arg.value;
  }

  return arg;
};

const signalArgToKefirProperty = <T>(arg: T | ReadonlySignal<T>): Observable<T, any> => {
  if (isSignal<T>(arg)) {
    return createKefirPropertyFromSubscribe(() => arg.value, (listener) => arg.subscribe(listener));
  }

  return createConstantKefirProperty(arg);
};

const kefirSelectorPropertyToSignal = <R>(
  selected: KefirSelectorProperty<R>
): ReadonlySignal<R> => {
  let activeWatchers = 0;
  let subscription: Subscription | null = null;

  const updateSnapshotIfAvailable = () => {
    try {
      output.value = selected.getSnapshot();
    } catch {
      // The owning StoreRuntime may have been disposed before signal cleanup runs.
    }
  };

  const output: Signal<R> = signal(selected.getSnapshot(), {
    watched() {
      const wasInactive = activeWatchers === 0;
      activeWatchers += 1;
      if (wasInactive) {
        updateSnapshotIfAvailable();
        subscription = selected.property.observe((value) => {
          if (output.value !== value) {
            output.value = value;
          }
        });
      }
    },
    unwatched() {
      activeWatchers = Math.max(0, activeWatchers - 1);
      if (activeWatchers === 0) {
        subscription?.unsubscribe();
        subscription = null;
        updateSnapshotIfAvailable();
      }
    },
  });

  return output;
};

export const createSelectorFromSignalState = <TStore extends ReactStore<any, any>, ARGS extends any[] = [], R = unknown>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, SignalState<TStore>>,
  selectorCadenceSourceOrFrequency: SelectorCadenceSourceSource = DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  traceReporter?: SelectorTraceReporter<SignalState<TStore>, R, ARGS>,
  shouldTraceSelectorCache?: () => boolean
): StoreReactSelector<R, ARGS, SignalState<TStore>, TStore> => {
  if (!isStoreRuntime(store)) {
    throw new TypeError("createSelectorFromSignalState requires a Store-like state source as the first argument.");
  }

  const effectiveTraceReporter = traceReporter ?? store.getSelectorTraceReporter<SignalState<TStore>, R, ARGS>();
  const effectiveShouldTraceSelectorCache =
    shouldTraceSelectorCache ?? (() => store.shouldTraceSelectorCache());
  void selectorCadenceSourceOrFrequency;
  const boundSelector = (
    store: TStore,
    ...restArgs: SignalArgs<ARGS>
  ): ReadonlySignal<R> => {
    return getOrCreate(store, selectorFunc, restArgs, () => {
      const argProperties = restArgs.map(signalArgToKefirProperty);
      const selected = createKefirSelectorProperty<TStore, ARGS, R>(
        store,
        selectorFunc,
        argProperties,
        () => restArgs.map(readSignalArg) as ARGS,
        effectiveTraceReporter
      );
      return kefirSelectorPropertyToSignal(selected);
    }, effectiveShouldTraceSelectorCache() ? { traceReporter: effectiveTraceReporter } : undefined);
  };

  const signalSelector = ((...restArgs: SignalArgs<ARGS>) => {
    return boundSelector(store, ...restArgs);
  }) as StoreReactSelector<R, ARGS, SignalState<TStore>, TStore>;

  signalSelector.useValue = (...args: SignalArgs<ARGS>) => {
    useSignals();
    return signalSelector(...args).value;
  };
  signalSelector.withStore = (store: TStore) => {
    return (...args: SignalArgs<ARGS>) => boundSelector(store, ...args);
  };
  signalSelector.select = selectorFunc;
  signalSelector.effect = (...args: ARGS) => {
    return select(selectorFunc as StoreSelectorCallback<R, ARGS>, ...args);
  };

  return signalSelector;
};

const createSelectorImpl = <TStore extends ReactStore<any, any>, ARGS extends any[] = [], R = unknown>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, SignalState<TStore>>
): StoreReactSelector<R, ARGS, SignalState<TStore>, TStore> => {
  return createSelectorFromSignalState(
    store,
    selectorFunc
  );
};

export const createSelector = createSelectorImpl as CreateReactSelector;
