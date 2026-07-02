import { memoize, debounce, throttle } from "lodash";
import { useMemo } from "react";
import { derived, readable } from "svelte/store";
import { selectReady, selectTodoById, selectTodos } from "../todos/todos-selectors";

export const selectLegacyTodos = memoize((state) => state.todos.items);
export const selectWrappedTodos = memoize(store.createSelector((state) => state.todos.items));
export const selectLodashMemoizedTodos = _.memoize(selectTodos);

export function TodoView({ id }) {
  const todos = useMemo(() => selectTodos(), []);
  const debouncedTodo = debounce(() => selectTodoById(id), 100);
  const throttledReady = throttle(() => selectReady.select(store.state), 100);
  const derivedTodos = derived(selectTodos(), ($todos) => $todos.length);
  const readableTodos = readable([], (set) => selectTodos().subscribe(set));
  return { todos, debouncedTodo, throttledReady, derivedTodos, readableTodos };
}