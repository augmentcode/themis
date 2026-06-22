import { select } from "typed-redux-saga";

export function* todosSaga() {
  const ready = yield* select((state) => state.todos.ready);
  return ready;
}