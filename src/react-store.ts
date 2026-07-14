import { signal, type ReadonlySignal, type Signal } from '@preact/signals-react';
import type { Observable, Subscription } from 'kefir';
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

const createSignalFromStoreStateStream = <TState>(
  storeStateStream: Observable<TState, any>,
  getSnapshot: () => TState
): { signalState: Signal<TState>; dispose: () => void } => {
  let activeWatchers = 0;
  let subscription: Subscription | null = null;

  const stopObserving = () => {
    subscription?.unsubscribe();
    subscription = null;
  };

  const emit = (state: TState) => {
    if (signalState.value !== state) {
      signalState.value = state;
    }
  };

  const emitSnapshotIfAvailable = () => {
    try {
      emit(getSnapshot());
    } catch {
      // StoreRuntime may already be disposed when React signal watchers unsubscribe.
    }
  };

  const startObserving = () => {
    if (subscription === null) {
      subscription = storeStateStream.observe((state) => emit(state));
    }
  };

  const signalState = signal(getSnapshot(), {
    watched() {
      const wasInactive = activeWatchers === 0;
      activeWatchers += 1;
      if (wasInactive) {
        emitSnapshotIfAvailable();
        startObserving();
      }
    },
    unwatched() {
      activeWatchers = Math.max(0, activeWatchers - 1);
      if (activeWatchers === 0) {
        stopObserving();
        emitSnapshotIfAvailable();
      }
    },
  });

  return {
    signalState,
    dispose() {
      stopObserving();
      activeWatchers = 0;
    },
  };
};

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

    const cadencedSignalState = createSignalFromStoreStateStream<StoreBoundState<TStateMap>>(
      this.getStoreStateStream(),
      () => this.getStoreStateSnapshot()
    );
    this.signalState = cadencedSignalState.signalState;
    this.disposeSignalState = cadencedSignalState.dispose;
    this.startSagaManager(storeContext);

    return () => {
      this.dispose();
    };
  }

  createSelector<ARGS extends any[] = [], R = unknown>(
    selectorFunc: StoreSelectorCallback<R, ARGS, StoreBoundState<TStateMap>>
  ): StoreReactSelector<R, ARGS, StoreBoundState<TStateMap>> {
    return createSelectorFromSignalState<StoreBoundState<TStateMap>, ARGS, R>(
      this,
      selectorFunc
    );
  }

  getStateObservable(): ReadonlySignal<StoreBoundState<TStateMap>> {
    if (!this.signalState) {
      throw new Error(
        'Cannot access ReactStore.getStateObservable() before Store.init() has been called.'
      );
    }

    this.signalState.value = this.getStoreStateSnapshot();
    return this.signalState;
  }

  dispose(): void {
    super.dispose();
    this.disposeSignalState?.();
    this.disposeSignalState = undefined;
    this.signalState = undefined;
  }
}