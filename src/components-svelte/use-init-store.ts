import { onDestroy } from 'svelte';
import type { Store } from '../svelte-store';
import type { PreloadedStoreState } from '../types';

/**
 * Initialize the store and automatically dispose on component destroy.
 * Call at component init time (e.g., in root layout).
 *
 * @param store - The Store instance with registered reducers and sagas
 * @param initialState - Optional preloaded state
 */
export function useInitStore(store: Store, initialState?: PreloadedStoreState): void {
  const dispose = store.init(initialState);
  onDestroy(dispose);
}

