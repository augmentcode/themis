import { take, takeEvery } from "typed-redux-saga";

function* anyActionWorker() {}

export function* todosSaga() {
  yield* take("*");
  yield* takeEvery(["*"], anyActionWorker);
}
