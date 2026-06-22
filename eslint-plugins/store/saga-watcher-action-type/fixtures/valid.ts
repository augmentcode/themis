import { takeEvery } from "typed-redux-saga";
import { loadTodos } from "../todos-slice";

function* loadTodosWorker(action: ReturnType<typeof loadTodos>) {
  yield* Promise.resolve(action.payload);
}

export function* todosSaga() {
  yield* takeEvery(loadTodos, loadTodosWorker);
}