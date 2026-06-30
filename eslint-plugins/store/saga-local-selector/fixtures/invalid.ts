import { createSelector } from "../../../../src/utils/selector-core/create-cached-selector";

const selectReady = (state: { todos: { ready: boolean } }) => state.todos.ready;

function selectDone(state: { todos: { done: boolean } }) {
  return state.todos.done;
}

export const selectCount = createSelector(
  [(state: { todos: { items: unknown[] } }) => state.todos.items],
  (items) => items.length
);

export function* todosSaga() {
  return selectReady;
}
