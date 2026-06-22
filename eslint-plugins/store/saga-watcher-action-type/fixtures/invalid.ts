import { takeEvery } from "typed-redux-saga";
import { loadTodos } from "../todos-slice";

function* loadTodosWorker() {}

export function* todosSaga() {
  yield* takeEvery(loadTodos.type, loadTodosWorker);
}