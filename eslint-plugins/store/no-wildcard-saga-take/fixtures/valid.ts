import { take, takeEvery } from "typed-redux-saga";
import { loadTodos, refreshTodos } from "../todos-slice";

function* loadTodosWorker() {}

export function* todosSaga(channel: unknown) {
  yield* take(channel);
  yield* take(loadTodos);
  yield* takeEvery([loadTodos, refreshTodos], loadTodosWorker);
}
