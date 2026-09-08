import { createSelector } from "../../../../src/utils/selector-core/create-cached-selector";
import { Store } from "@augmentcode/themis/svelte-store";

const store = new Store();
const makeSelector = store.createSelector;

const selectReady = (state: { todos: { ready: boolean } }) => state.todos.ready;

function selectDone(state: { todos: { done: boolean } }) {
  return state.todos.done;
}

export const selectCount = createSelector(
  [(state: { todos: { items: unknown[] } }) => state.todos.items],
  (items) => items.length
);

const localSelector = makeSelector((state: { todos: { items: unknown[] } }) => state.todos.items);
const cachedSelector = createSelector((state: { todos: { ready: boolean } }) => state.todos.ready);

export function* todosSaga() {
  return selectReady;
}
