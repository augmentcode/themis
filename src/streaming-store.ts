import {
  type StoreOptions,
  type StoreSelectorCallback,
  type StoreStateMap,
} from './types';
import {
  StoreRuntime,
  type StoreBoundState,
  type StoreMiddlewareInput,
  type StoreReducersInput,
} from './store-runtime';
import { createSelector as createStreamingSelector } from './utils/streaming-selectors/create-selector';
import type { StoreStreamingSelector } from './utils/streaming-selectors/types';

export type { StoreOptions } from './types';

/**
 * Kefir/observable Store variant. Its selectors return Kefir streams when
 * called and keep .select/.effect escape hatches for tests and sagas.
 */
export class StreamingStore<
  TStateMap extends StoreStateMap = {},
  TReducers extends StoreReducersInput<TStateMap> = StoreReducersInput<TStateMap>,
> extends StoreRuntime<TStateMap, TReducers> {
  /**
   * Create a streaming Store with app-owned reducers and middlewares.
   * Throws if any reducer uses a package-reserved internal key.
   */
  constructor(
    reducersMap?: TReducers & StoreReducersInput<TStateMap>,
    middleware?: StoreMiddlewareInput,
    options?: StoreOptions
  ) {
    super(reducersMap, middleware, options);
  }

  createSelector<ARGS extends any[] = [], R = unknown>(
    selectorFunc: StoreSelectorCallback<R, ARGS, StoreBoundState<TStateMap>>
  ): StoreStreamingSelector<R, ARGS, StoreBoundState<TStateMap>, StreamingStore<TStateMap, TReducers>> {
    return createStreamingSelector<StreamingStore<TStateMap, TReducers>, ARGS, R>(
      this,
      selectorFunc
    );
  }
}