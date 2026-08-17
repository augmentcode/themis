import {
  type StoreOptions,
  type StoreStateMap,
  type StoreSelector,
  type StoreSelectorCallback,
} from './types';
import {
  StoreRuntime,
  type StoreBoundState,
  type StoreMiddlewareInput,
  type StoreReducersInput,
} from './store-runtime';
import type { ReduxStoreContext } from './internal-types';
import { getStoreContext } from './utils/runtime-svelte/utils';
import { createSelector as createSvelteSelector } from './utils/svelte-selectors/create-selector';

export type { SelectorTraceSummary, StoreOptions } from './types';
export { getDispatch } from './utils/runtime-svelte/utils';

/**
 * Canonical Svelte-readable Store. Its selectors return Svelte Readable values
 * when called and keep .select/.effect escape hatches for tests and sagas.
 */
export class Store<
  TStateMap extends StoreStateMap = {},
  TReducers extends StoreReducersInput<TStateMap> = StoreReducersInput<TStateMap>,
> extends StoreRuntime<TStateMap, TReducers> {
  /**
   * Create a Svelte-readable Store with app-owned reducers and middlewares.
   * Throws if any reducer uses a package-reserved internal key.
   */
  constructor(
    reducersMap?: TReducers & StoreReducersInput<TStateMap>,
    middleware?: StoreMiddlewareInput,
    options?: StoreOptions
  ) {
    super(reducersMap, middleware, options);
  }

  /**
   * Svelte stores also treat a store context already present in the Svelte
   * component tree as existing, so nested <Store/> components skip init.
   */
  protected getExistingStoreContext(): ReduxStoreContext | undefined {
    return getStoreContext() ?? super.getExistingStoreContext();
  }

  createSelector<ARGS extends any[] = [], R = unknown>(
    selectorFunc: StoreSelectorCallback<R, ARGS, StoreBoundState<TStateMap>>
  ): StoreSelector<R, ARGS, StoreBoundState<TStateMap>, Store<TStateMap, TReducers>> {
    return createSvelteSelector<Store<TStateMap, TReducers>, ARGS, R>(
      this,
      selectorFunc
    );
  }
}