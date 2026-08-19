import { call, delay, takeEvery, fork, setContext, put } from "typed-redux-saga";
import {
  addCrash,
  startSaga,
  stopSaga,
  type SerializedSagaCrashReport,
  type SerializedSagaError,
} from "../saga-manager-slice";
import { type Task } from "redux-saga";
import type { ReduxStore, SagaCrashRecord, SagaStatusRecord } from "../../../internal-types";
import type { StoreRuntimeErrorReporter } from "../../../types";
import { type Saga } from "redux-saga";
import { type SagaReturnType } from "redux-saga/effects";
import { selectUpdatesLocked } from "../../store-utility/store-utility-selectors";
import { unlockUpdates } from "../../store-utility/store-utility-slice";

const DECREASE_RESTARTS_COUNT_DELAY = 60 * 1000; // a minute
/*
  Allow to run though all attempts in 1/4 of time.
  important to have RESTART_DELAY short enough, so constantly failing saga will be terminated eventually,
  but a saga that fails once in a while will not run out of restart attempts;
*/
const RESTART_DELAY = 1000;
const MAX_RESTART_DELAY = 10 * 60 * 1000;

export const getBackOffDelay = (restarts: number) => {
  return Math.min(RESTART_DELAY * Math.pow(2, restarts), MAX_RESTART_DELAY);
};

const createSagaStatusRecord = (): SagaStatusRecord => ({
  isRunning: false,
  launchedAtTs: null,
  crashes: [],
});

const cloneSagaStatusRecord = (status: SagaStatusRecord): SagaStatusRecord => ({
  ...status,
  crashes: status.crashes.map((crash) => ({ ...crash })),
});

const toError = (error: unknown): Error => {
  return error instanceof Error ? error : new Error(String(error));
};

const serializeSagaError = (error: unknown): SerializedSagaError => {
  if (error instanceof Error) {
    const serializedError: SerializedSagaError = {
      name: error.name || "Error",
      message: error.message,
    };

    if (typeof error.stack === "string") {
      serializedError.stack = error.stack;
    }

    return serializedError;
  }

  return {
    name: "Error",
    message: String(error),
  };
};

const serializeSagaCrashReport = (
  error: unknown,
  crashedAtTs: number
): SerializedSagaCrashReport => ({
  crashedAtTs,
  error: serializeSagaError(error),
});

const autoRestart = (
  sagaName: string,
  sagaFn: Saga,
  onCrash?: (crashes: SagaCrashRecord[]) => void,
  initialCrashes: SagaCrashRecord[] = [],
  reportRuntimeError?: StoreRuntimeErrorReporter
) => {
  return function* autoRestarting(...args: Parameters<typeof sagaFn>) {
    let restarts = 0;
    let restartsCount = 0;
    let lastTimeStarted = +new Date();
    const crashes: SagaCrashRecord[] = initialCrashes.map((crash) => ({ ...crash }));

    while (true) {
      try {
        yield* call(sagaFn, ...args); // `call(..)` blocks generator execution
        break; // if saga finished successfully no need to restart it
      } catch (e) {
        const crashedAtTs = Date.now();
        const error = toError(e);
        const crashReport = serializeSagaCrashReport(e, crashedAtTs);
        crashes.push({
          crashedAt: new Date(crashedAtTs),
          error,
        });
        onCrash?.([...crashes]);
        yield* put(addCrash(sagaName, crashReport));

        const wasStoreLocked = yield* selectUpdatesLocked.effect();
        if (wasStoreLocked) {
          yield* put(unlockUpdates());
        }
        /*
          Decrease restarts proportionally time passed since last restart and increase by 1;
          This allows to increase available restart attempts over time,
          but will terminate permanently a saga that fails more than `RESTART_LIMITS` per `DECREASE_RESTARTS_COUNT_DELAY`ms;
        */
        const backoffDelay = getBackOffDelay(restarts);
        restartsCount++;

        restarts =
          Math.max(
            0,
            restarts - Math.floor((+new Date() - lastTimeStarted) / DECREASE_RESTARTS_COUNT_DELAY)
          ) + 1;
        lastTimeStarted = +new Date();

        const errorMessage = `Saga "${sagaName}" crashed ${restartsCount === 1 ? "first time" : restartsCount + " times"}. Restarting... (restart in ${backoffDelay / 1000}s)\n`;
        reportRuntimeError?.({
          error: e,
          source: "saga-manager",
          message: errorMessage,
        });

        yield* delay(backoffDelay);
      }
    }
  };
};

type SagaTaskRecord = {
  task: Task<SagaReturnType<any>>;
  name: string;
  counter: number;
};

/**
 * Context exposed by the saga manager for monitoring saga statuses.
 */
export type SagaManagerContext = {
  tasks: Record<string, SagaStatusRecord>;
};

/**
 * The saga manager orchestrates lifecycle of started sagas.
 * Store.runSaga sends both the saga name and function so sagas registered after
 * Store.init() can be started and retained for restart handling.
 *
 * @param reduxStore - The actual Redux store exposed to selector-channel effects
 * @param exposeContext - Callback to expose saga status for monitoring/debugging
 */
export function* sagaManager(
  reduxStore: ReduxStore,
  exposeContext: (tasks: SagaManagerContext["tasks"]) => void,
  reportRuntimeError?: StoreRuntimeErrorReporter
) {
  yield* setContext({
    reduxStore,
    reportRuntimeError,
  });

  const startedSagas = new Map<string, Saga>();
  const runningTasks = new Map<string, SagaTaskRecord>();
  const sagaStatuses = new Map<string, SagaStatusRecord>();

  const getSagaStatus = (sagaName: string) => {
    const existingStatus = sagaStatuses.get(sagaName);
    if (existingStatus) {
      return existingStatus;
    }

    const newStatus = createSagaStatusRecord();
    sagaStatuses.set(sagaName, newStatus);
    return newStatus;
  };

  const setSagaStatus = (
    sagaName: string,
    updater: (status: SagaStatusRecord) => SagaStatusRecord
  ) => {
    sagaStatuses.set(sagaName, updater(getSagaStatus(sagaName)));
  };

  const updateContext = () => {
    exposeContext(
      Object.fromEntries(
        Array.from(sagaStatuses.keys()).map((name) => {
          return [name, cloneSagaStatusRecord(getSagaStatus(name))];
        })
      )
    );
  };

  yield* takeEvery(startSaga, function* (action) {
    const [sagaName, saga] = action.payload;
    const runningTask = runningTasks.get(sagaName);
    if (runningTask) {
      if (!runningTask.task.isRunning()) {
        // Task completed (e.g., noop saga or autoRestart broke out); clean up stale entry
        runningTasks.delete(sagaName);
        setSagaStatus(sagaName, (status) => ({
          ...status,
          isRunning: false,
        }));
      } else {
        const storedSaga = startedSagas.get(sagaName);
        if (storedSaga && storedSaga !== saga) {
          throw new Error(
            `Saga "${sagaName}" is already running with a different saga function.`
          );
        }

        const updatedRecord = {
          ...runningTask,
          counter: runningTask.counter + 1,
        };

        runningTasks.set(sagaName, updatedRecord);
        updateContext();
        return;
      }
    }
    startedSagas.set(sagaName, saga);
    const startedSaga = startedSagas.get(sagaName);
    if (!startedSaga) {
      const message = `Saga "${sagaName}" not found in registry`;
      reportRuntimeError?.({
        error: new Error(message),
        source: "saga-manager",
        message,
      });
      return;
    }
    const autorestartingSaga = autoRestart(
      sagaName,
      startedSaga,
      (crashes) => {
        setSagaStatus(sagaName, (status) => ({
          ...status,
          crashes: [...crashes],
        }));
        updateContext();
      },
      getSagaStatus(sagaName).crashes,
      reportRuntimeError
    );
    const task = yield* fork(autorestartingSaga);
    const isRunning = task.isRunning();
    if (isRunning) {
      const newTaskRecord: SagaTaskRecord = {
        task,
        name: sagaName,
        counter: 1,
      };
      runningTasks.set(sagaName, newTaskRecord);
    }
    setSagaStatus(sagaName, (status) => ({
      ...status,
      isRunning,
      launchedAtTs: Date.now(),
    }));
    updateContext();
  });

  yield* takeEvery(stopSaga, function (action) {
    const [sagaName] = action.payload;
    const runningTask = runningTasks.get(sagaName);
    if (!runningTask) {
      return;
    }
    const updatedRecord = {
      ...runningTask,
      counter: runningTask.counter - 1,
    };

    if (updatedRecord.counter <= 0) {
      updatedRecord.task.cancel();
    }

    if (updatedRecord.task.isCancelled()) {
      runningTasks.delete(sagaName);
      setSagaStatus(sagaName, (status) => ({
        ...status,
        isRunning: false,
      }));
    } else {
      runningTasks.set(sagaName, updatedRecord);
      setSagaStatus(sagaName, (status) => ({
        ...status,
        isRunning: updatedRecord.task.isRunning(),
      }));
    }
    updateContext();
  });
}

