import { createAction } from "../../utils/store/create-action";
import { createReducer } from "../../utils/store/create-reducer";
import type { Saga } from "redux-saga";

export const MAX_SAGA_CRASH_REPORTS = 100;

export type SerializedSagaError = {
  name: string;
  message: string;
  stack?: string;
};

export type SerializedSagaCrashReport = {
  crashedAtTs: number;
  error: SerializedSagaError;
};

export type SagaCrashReports = {
  reports: SerializedSagaCrashReport[];
  omittedCount: number;
};

export type SagaCrashState = Record<string, SagaCrashReports>;

const initialState: SagaCrashState = {};

/*
    These actions are for components only, it is unsafe to dispatch them
    without attaching to a lifecycle with dispose method.
    Every dispatch of startSaga should be accompanied with a handler that calls stopSaga for it.
    This is done by Store.runSaga and useRunSaga lifecycles.
*/
export const startSaga = createAction<[sagaName: string, saga: Saga]>(
  "sagaManager/startSaga"
);
export const stopSaga = createAction<[string]>("sagaManager/stopSaga");

export const addCrash = createAction<[sagaName: string, report: SerializedSagaCrashReport]>(
  "sagaManager/addCrash"
);

export const clearCrashes = createAction<[sagaName: string]>("sagaManager/clearCrashes");

export const sagaManagerReducer = createReducer<SagaCrashState>(initialState)
  .with(addCrash, (state, action) => {
    const [sagaName, report] = action.payload;
    const currentReports = state[sagaName]?.reports ?? [];
    const currentOmittedCount = state[sagaName]?.omittedCount ?? 0;
    const reportsWithNewCrash = [...currentReports, report];
    const omittedReports = Math.max(0, reportsWithNewCrash.length - MAX_SAGA_CRASH_REPORTS);

    return {
      ...state,
      [sagaName]: {
        reports: omittedReports > 0 ? reportsWithNewCrash.slice(omittedReports) : reportsWithNewCrash,
        omittedCount: currentOmittedCount + omittedReports,
      },
    };
  })
  .with(clearCrashes, (state, action) => {
    const [sagaName] = action.payload;

    if (!state[sagaName]) {
      return state;
    }

    const nextState = { ...state };
    delete nextState[sagaName];

    return nextState;
  });

