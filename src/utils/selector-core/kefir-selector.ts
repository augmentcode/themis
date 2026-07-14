import Kefir, { type Observable, type Property } from "kefir";
import type { StoreSelectorCallback } from "../../types";
import {
  createCachedSelector,
  type SelectorTraceReporter,
} from "./create-cached-selector";
import { areStoreUpdatesLocked } from "./store-update-lock";

export type RuntimeKefirStateSource<TState> = {
  stream: Observable<TState, any>;
  getSnapshot: () => TState;
};

export type StoreRuntimeKefirStateSource<TState> = {
  getStoreStateStream: () => Observable<TState, any>;
  getStoreStateSnapshot: () => TState;
};

export const getRuntimeKefirStateSource = <TState>(
  source: StoreRuntimeKefirStateSource<TState>
): RuntimeKefirStateSource<TState> => {
  return {
    stream: source.getStoreStateStream(),
    getSnapshot: () => source.getStoreStateSnapshot(),
  };
};

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

export type KefirSelectorProperty<T> = {
  property: Property<T, any>;
  getSnapshot: () => T;
};

export const createKefirSelectorProperty = <TState, ARGS extends any[], R>(
  stateSource: RuntimeKefirStateSource<TState>,
  selectorFunc: StoreSelectorCallback<R, ARGS, TState>,
  argProperties: Array<Observable<any, any>>,
  getArgsSnapshot: (() => ARGS) | undefined,
  traceReporter?: SelectorTraceReporter<TState, R, ARGS>
): KefirSelectorProperty<R> => {
  const cachedSelector = createCachedSelector<TState, ARGS, R>(selectorFunc, {
    lockUpdatesPredicate: areStoreUpdatesLocked,
    traceReporter,
  });
  const getSnapshot = () => {
    if (!getArgsSnapshot) {
      throw new Error("Cannot synchronously snapshot selector observable arguments.");
    }
    return cachedSelector(stateSource.getSnapshot(), ...getArgsSnapshot());
  };
  const combinedInputs = [stateSource.stream, ...argProperties] as Array<Observable<any, any>>;
  const selected = (Kefir.combine(combinedInputs as any) as Observable<any[], any>)
    .map(([storeState, ...args]) => {
      return cachedSelector(storeState as TState, ...(args as ARGS));
    })
    .skipDuplicates();
  const property = (getArgsSnapshot
    ? selected.toProperty(getSnapshot)
    : selected.toProperty()) as Property<R, any>;

  return { property, getSnapshot };
};