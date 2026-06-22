import type { Store, UnknownAction } from 'redux';
import type { StoreState } from './types';

export type SagaCrashRecord = {
  crashedAt: Date;
  error: Error;
};

export type SagaStatusRecord = {
  isRunning: boolean;
  launchedAtTs: number | null;
  crashes: SagaCrashRecord[];
};

export type ReduxStore = Store<StoreState, UnknownAction>;

export type ReduxStoreContext = {
  store: ReduxStore;
  tasks?: Record<string, SagaStatusRecord>;
};
