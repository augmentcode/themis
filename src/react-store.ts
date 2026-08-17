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
import { createSelector as createReactSelector } from './utils/react-selectors/create-selector';
import type { StoreReactSelector } from './utils/react-selectors/types';

export type { SelectorTraceSummary, StoreOptions } from './types';

/**
 * React signal Store variant. Its selectors return Preact React signals when
 * called and expose .useValue/.select/.effect escape hatches for React, tests, and sagas.
 */
export class ReactStore<
  TStateMap extends StoreStateMap = {},
  TReducers extends StoreReducersInput<TStateMap> = StoreReducersInput<TStateMap>,
> extends StoreRuntime<TStateMap, TReducers> {
  /**
   * Create a React signal Store with app-owned reducers and middlewares.
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
  ): StoreReactSelector<R, ARGS, StoreBoundState<TStateMap>, ReactStore<TStateMap, TReducers>> {
    return createReactSelector<ReactStore<TStateMap, TReducers>, ARGS, R>(
      this,
      selectorFunc
    );
  }
}