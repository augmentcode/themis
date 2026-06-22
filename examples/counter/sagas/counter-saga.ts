/**
 * Counter Saga — handles side effects for the counter example.
 *
 * It demonstrates two common patterns: reacting to one action with
 * `takeEvery`, and starting/stopping background work with `take`, `fork`,
 * and `cancel`.
 */

import { cancel, delay, fork, put, select, take, takeEvery } from "typed-redux-saga";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { increment, type CounterState } from "../counter-slice";

type CounterSagaState = {
  counter: CounterState;
};

// Saga-only actions trigger behavior that reducers do not handle.

/** Start auto-incrementing every second */
export const startAutoIncrement = createAction("counter/startAutoIncrement");

/** Stop auto-incrementing */
export const stopAutoIncrement = createAction("counter/stopAutoIncrement");

/** Log the current count to console (demonstrates reading state in saga) */
export const logCount = createAction("counter/logCount");

/**
 * Reads the current count from state and logs it.
 */
function* handleLogCount() {
  const count = yield* select((state: CounterSagaState) => state.counter.count);
  console.log(`[Counter Saga] Current count: ${count}`);
}

function* autoIncrementLoop() {
  while (true) {
    yield* delay(1000);
    yield* put(increment());
  }
}

/**
 * Starts the counter watchers.
 */
export function* counterSaga() {
  yield* takeEvery(logCount, handleLogCount);

  while (true) {
    yield* take(startAutoIncrement);
    const autoIncrementTask = yield* fork(autoIncrementLoop);
    yield* take(stopAutoIncrement);
    yield* cancel(autoIncrementTask);
  }
}

