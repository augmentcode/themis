import { call } from "typed-redux-saga";

const api = { fetchTodos: async () => ["todo"] };

export function* todosSaga() {
  const todos = yield* call(api.fetchTodos);
  return todos;
}