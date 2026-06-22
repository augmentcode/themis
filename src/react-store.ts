import { signal, type ReadonlySignal, type Signal } from '@preact/signals-react';
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
  createSelectorFromSignalState,
  type StoreReactSelector,
} from './utils/react-selectors/create-selector';

export type { StoreOptions } from './types';

/**
 * React signal Store variant. Its selectors return Preact React signals when
 * called and expose .useValue/.select/.effect escape hatches for React, tests, and sagas.
 */
export class ReactStore<
  TStateMap extends StoreStateMap = {},
  TReducers extends StoreReducersInput<TStateMap> = StoreReducersInput<TStateMap>,
> extends StoreRuntime<TStateMap, TReducers> {
  private signalState: Signal<StoreBoundState<TStateMap>> | undefined;
  private disposeSignalState: (() => void) | undefined;

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

  init(initialState?: PreloadedStoreState): () => void {
    const storeContext = this.initStoreContext(initialState);
    if (!storeContext) {
      return () => {};
    }

    this.signalState = signal(storeContext.store.getState() as StoreBoundState<TStateMap>);
    this.disposeSignalState = storeContext.store.subscribe(() => {
      this.signalState!.value = storeContext.store.getState() as StoreBoundState<TStateMap>;
    });
    this.startSagaManager(storeContext);

    return () => {
      this.dispose();
    };
  }

  createSelector<ARGS extends any[] = [], R = unknown>(
    selectorFunc: StoreSelectorCallback<R, ARGS, StoreBoundState<TStateMap>>
  ): StoreReactSelector<R, ARGS, StoreBoundState<TStateMap>> {
    return createSelectorFromSignalState<StoreBoundState<TStateMap>, ARGS, R>(
      () => this.getSignalState(),
      selectorFunc,
      () => this.getSelectorFlushManager(),
      this.getSelectorTraceReporter<StoreBoundState<TStateMap>, R, ARGS>()
    );
  }

  getSignalState(): ReadonlySignal<StoreBoundState<TStateMap>> {
    if (!this.signalState) {
      throw new Error(
        'Cannot access ReactStore.getSignalState() before Store.init() has been called.'
      );
    }

    return this.signalState;
  }

  dispose(): void {
    super.dispose();
    this.disposeSignalState?.();
    this.disposeSignalState = undefined;
    this.signalState = undefined;
  }
}