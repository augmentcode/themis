import type { Readable } from "svelte/store";
import type { StoreRuntime } from "../../store-runtime";
import type {
  StoreSelectorCallback,
  StoreSelectorEffect,
  StoreState,
} from "../../types";

export type SvelteReadableArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | Readable<ARGS[K]>;
};

export type SvelteStoreSelector<
  R,
  ARGS extends any[] = [],
  TState = StoreState,
  TStore extends StoreRuntime<any, any> = StoreRuntime<any, any>,
> = ((...args: SvelteReadableArgs<ARGS>) => Readable<R>) & {
  withStore: (store: TStore) => (...args: SvelteReadableArgs<ARGS>) => Readable<R>;
  select: StoreSelectorCallback<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};