import { onMount, onDestroy } from 'svelte';
import type { Saga } from 'redux-saga';
import { getStoreContext } from '../utils/runtime-svelte/utils';
import { deriveSagaName } from '../utils/sagas/derive-saga-name';
import {
  startSaga,
  stopSaga as stopSagaAction,
} from '../slices/saga-manager/saga-manager-slice';

/**
 * Start a saga when the component mounts and stop it when it unmounts.
 * Call this at component init time to start a saga with automatic cleanup.
 *
 * @param saga - The saga function to run
 */
export function useRunSaga(saga: Saga): void {
  const storeContext = getStoreContext();
  if (!storeContext) return;

  let stopSaga: (() => void) | undefined;

  onMount(() => {
    const sagaName = deriveSagaName(saga);
    storeContext.store.dispatch(startSaga(sagaName, saga));
    stopSaga = () => {
      storeContext.store.dispatch(stopSagaAction(sagaName));
    };
  });

  onDestroy(() => {
    stopSaga?.();
  });
}

