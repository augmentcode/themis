import type { Observable } from "kefir";
import type { StreamingStore } from "../../streaming-store";
import type {
  StoreSelectorCallback,
  StoreSelectorEffect,
  StoreState,
} from "../../types";

export type StreamingArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | Observable<ARGS[K], any>;
};

export type StoreStreamingSelector<
  R,
  ARGS extends any[] = [],
  TState = StoreState,
  TStore extends StreamingStore<any, any> = StreamingStore<any, any>,
> = ((...args: StreamingArgs<ARGS>) => Observable<R, any>) & {
  withStore: (store: TStore) => (...args: StreamingArgs<ARGS>) => Observable<R, any>;
  select: StoreSelectorCallback<R, ARGS, TState>;
  effect: StoreSelectorEffect<R, ARGS>;
};