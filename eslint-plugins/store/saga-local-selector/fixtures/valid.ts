import { selectReady, selectDone } from "../todos-selectors";
import { createSelector } from "../../../../src/utils/selector-core/create-cached-selector";

const unrelated = { createSelector };
const cachedSelector = createSelector((state: { todos: { ready: boolean } }) => state.todos.ready);
const unrelatedSelector = unrelated.createSelector((state: { todos: { done: boolean } }) => state.todos.done);

export function* todosSaga() {
  const ready = yield* selectReady.effect();
  const done = yield* selectDone.effect();
  return { ready, done };
}
