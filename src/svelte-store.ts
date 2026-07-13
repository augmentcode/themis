import type { Readable } from 'svelte/store';
import {
  type PreloadedStoreState,
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
import { createSelectorFromReadableState } from './utils/svelte-selectors/create-selector';
import { createStoreStateReadable } from './utils/svelte-selectors/create-readable-store-state';

export type { StoreOptions } from './types';
export { getDispatch } from './utils/runtime-svelte/utils';

/**
 * Canonical Svelte-readable Store. Its selectors return Svelte Readable values
 * when called and keep .select/.effect escape hatches for tests and sagas.
 */
export class Store<
  TStateMap extends StoreStateMap = {},
  TReducers extends StoreReducersInput<TStateMap> = StoreReducersInput<TStateMap>,
> extends StoreRuntime<TStateMap, TReducers> {
  private readableState: Readable<StoreBoundState<TStateMap>> | undefined;

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

  init(initialState?: PreloadedStoreState): () => void {
    const storeContext = this.initStoreContext(initialState);
    if (!storeContext) {
      return () => {};
    }

    this.readableState = createStoreStateReadable(storeContext.store) as Readable<
      StoreBoundState<TStateMap>
    >;
    this.startSagaManager(storeContext);

    return () => {
      this.dispose();
    };
  }

  createSelector<ARGS extends any[] = [], R = unknown>(
    selectorFunc: StoreSelectorCallback<R, ARGS, StoreBoundState<TStateMap>>
  ): StoreSelector<R, ARGS, StoreBoundState<TStateMap>> {
    return createSelectorFromReadableState<StoreBoundState<TStateMap>, ARGS, R>(
      this,
      selectorFunc
    );
  }

  getStateObservable(): Readable<StoreBoundState<TStateMap>> {
    if (!this.readableState) {
      throw new Error(
        'Cannot access Store.getStateObservable() before Store.init() has been called.'
      );
    }

    return this.readableState;
  }

  dispose(): void {
    super.dispose();
    this.readableState = undefined;
  }
}