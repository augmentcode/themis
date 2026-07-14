import Kefir, { type Observable, type Property } from "kefir";
import type { StoreRuntime } from "../../store-runtime";
import type { StoreSelectorCallback, StoreState } from "../../types";
import { createCachedSelector } from "./create-cached-selector";
import { areStoreUpdatesLocked } from "./store-update-lock";
import type { KefirSelectorProperty, SelectorTraceReporter } from "../types";

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
  traceReporter?: SelectorTraceReporter<StoreState<TStore>, R, ARGS>
): KefirSelectorProperty<R> => {
  const cachedSelector = createCachedSelector<StoreState<TStore>, ARGS, R>(selectorFunc, {
    lockUpdatesPredicate: areStoreUpdatesLocked,
    traceReporter,
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
    .skipDuplicates();
  const property = (getArgsSnapshot
    ? selected.toProperty(getSnapshot)
    : selected.toProperty()) as Property<R, any>;

  return { property, getSnapshot };
};