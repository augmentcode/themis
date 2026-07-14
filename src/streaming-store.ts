import { type Observable } from 'kefir';
import {
  type PreloadedStoreState,
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
import {
  createSelectorFromStreamState,
  type StoreStreamingSelector,
} from './utils/streaming-selectors/create-selector';

export type { StoreOptions } from './types';

/**
 * Kefir/observable Store variant. Its selectors return Kefir streams when
 * called and keep .select/.effect escape hatches for tests and sagas.
 */
export class StreamingStore<
  TStateMap extends StoreStateMap = {},
  TReducers extends StoreReducersInput<TStateMap> = StoreReducersInput<TStateMap>,
> extends StoreRuntime<TStateMap, TReducers> {
  private streamState: Observable<StoreBoundState<TStateMap>, any> | undefined;

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

  init(initialState?: PreloadedStoreState): () => void {
    const storeContext = this.initStoreContext(initialState);
    if (!storeContext) {
      return () => {};
    }

    this.streamState = this.getStoreStateStream() as Observable<
      StoreBoundState<TStateMap>,
      any
    >;
    this.startSagaManager(storeContext);

    return () => {
      this.dispose();
    };
  }

  createSelector<ARGS extends any[] = [], R = unknown>(
    selectorFunc: StoreSelectorCallback<R, ARGS, StoreBoundState<TStateMap>>
  ): StoreStreamingSelector<R, ARGS, StoreBoundState<TStateMap>> {
    return createSelectorFromStreamState<StoreBoundState<TStateMap>, ARGS, R>(
      this,
      selectorFunc
    );
  }

  getStateObservable(): Observable<StoreBoundState<TStateMap>, any> {
    if (!this.streamState) {
      throw new Error(
        'Cannot access StreamingStore.getStateObservable() before Store.init() has been called.'
      );
    }
    return this.streamState;
  }

  dispose(): void {
    super.dispose();
    this.streamState = undefined;
  }
}