import { fork } from "typed-redux-saga";
import { takeLatestFromSelector } from "@augmentcode/themis/saga";
import { selectReady } from "../todos-selectors";

function* readyWorker() {}

export function* todosSaga() {
  yield* fork(takeLatestFromSelector, selectReady, readyWorker);
}