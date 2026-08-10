import type { ReadonlySignal } from "@preact/signals-react";
import type { ReactStore } from "../../react-store";
import type {
  StoreSelectorCallback,
  StoreSelectorEffect,
  StoreState,
} from "../../types";

export type SignalArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | ReadonlySignal<ARGS[K]>;
};

export type StoreReactSelector<
  R,
  ARGS extends any[] = [],
  TState = StoreState,
  TStore extends ReactStore<any, any> = ReactStore<any, any>,
> = ((...args: SignalArgs<ARGS>) => ReadonlySignal<R>) & {
  useValue: (...args: SignalArgs<ARGS>) => R;
  withStore: (store: TStore) => (...args: SignalArgs<ARGS>) => ReadonlySignal<R>;
  select: StoreSelectorCallback<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};