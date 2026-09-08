import Kefir, { type Observable, type Property } from "kefir";
import type { StoreRuntime } from "../../store-runtime";
import type { StoreSelectorCallback, StoreState } from "../../types";
import { createCachedSelector } from "./create-cached-selector";
import { areStoreUpdatesLocked } from "./store-update-lock";
import type { KefirSelectorProperty, SelectorComputationTraceOptions } from "../types";
import { shallowEqual } from "fast-equals";

export type { KefirSelectorProperty } from "../types";

export const createKefirPropertyFromSubscribe = <T>(
  getSnapshot: () => T,
  subscribe: (listener: (value: T) => void) => (() => void) | { unsubscribe(): void }
): Property<T, any> => {
  return Kefir.stream<T, any>((emitter) => {
    const unsubscribe = subscribe((value) => emitter.value(value));
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      } else {
        unsubscribe.unsubscribe();
      }
    };
  }).toProperty(getSnapshot);
};

export const createConstantKefirProperty = <T>(value: T): Property<T, never> => {
  return Kefir.constant(value);
};

export const isKefirObservable = <T = any>(arg: unknown): arg is Observable<T, any> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "observe" in arg && typeof arg.observe === "function";
};

export const createKefirSelectorProperty = <TStore extends StoreRuntime<any, any>, ARGS extends any[], R>(
  stateSource: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, StoreState<TStore>>,
  argProperties: Array<Observable<any, any>>,
  getArgsSnapshot: (() => ARGS) | undefined,
  traceOptions?: SelectorComputationTraceOptions<StoreState<TStore>, R, ARGS>,
  onInactive?: () => void
): KefirSelectorProperty<R> => {
  const cachedSelector = createCachedSelector<StoreState<TStore>, ARGS, R>(selectorFunc, {
    lockUpdatesPredicate: areStoreUpdatesLocked,
    ...traceOptions,
  });
  const getSnapshot = () => {
    if (!getArgsSnapshot) {
      throw new Error("Cannot synchronously snapshot selector observable arguments.");
    }
    return cachedSelector(stateSource.getStoreStateSnapshot() as StoreState<TStore>, ...getArgsSnapshot());
  };
  const combinedInputs = [stateSource.getStoreStateStream(), ...argProperties] as Array<Observable<any, any>>;
  const selected = (Kefir.combine(combinedInputs as any) as Observable<any[], any>)
    .map(([storeState, ...args]) => {
      return cachedSelector(storeState as StoreState<TStore>, ...(args as ARGS));
    })
    .skipDuplicates((a, b) => {
      return shallowEqual(a, b);
    });
  const selectedProperty = (getArgsSnapshot
    ? selected.toProperty(getSnapshot)
    : selected.toProperty()) as Property<R, any>;

  if (!onInactive) {
    return { property: selectedProperty, getSnapshot };
  }

  const property = (Kefir.stream<R, any>((emitter) => {
    const subscription = selectedProperty.observe({
      value: (value) => emitter.value(value),
      error: (error) => emitter.error(error),
      end: () => emitter.end(),
    });
    return () => {
      subscription.unsubscribe();
      onInactive();
    };
  }).toProperty(getArgsSnapshot ? getSnapshot : undefined) as Property<R, any>);

  return { property, getSnapshot };
};