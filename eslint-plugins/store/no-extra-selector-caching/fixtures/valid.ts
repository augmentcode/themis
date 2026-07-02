import { derived } from "svelte/store";
import { Store } from "@augmentcode/themis/svelte-store";
import { selectTodos } from "../todos/todos-selectors";

export const store = new Store({ todos: todosReducer }, undefined, { throttledSelectorFrequency: 120 });

export const selectVisibleTodos = store.createSelector((state) => {
  return selectTodos.select(state).filter((todo) => todo.visible);
});

const todosReadable = selectTodos();
const todos = selectTodos.select(store.state);
const derivedOther = derived(otherReadable, ($other) => $other.length);

export const validSelectorUsage = { todosReadable, todos, derivedOther };