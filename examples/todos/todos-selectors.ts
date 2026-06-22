/**
 * Todos Selectors — demonstrates collection-aware selector patterns:
 *
 * - Basic collection selector: returns the whole collection
 * - Store-bound selector for O(1) item lookup by ID
 * - Derived selectors: compute values from collection data
 * - Using `getItems()` to convert a collection to an array for rendering
 *
 * Collections are stored normalized (ids + map). Use `getItems()` to get
 * the ordered array, and `collection.map[id]` for direct lookups.
 */

import { getItems, type Collection } from "@augmentcode/themis/utils/collections/collection-utils";
import { store } from "../store";
import type { Todo } from "./todos-slice";

/**
 * Returns the full todos collection.
 * Use `getItems(collection)` in components to get the array for rendering.
 */
export const selectTodos = store.createSelector<[], Collection<Todo, "id">>((state) => {
  return state.todos.todos;
});

/**
 * Looks up a single todo by ID using a Store-bound selector.
 * Returns `Todo | undefined`. Uses O(1) map lookup under the hood.
 *
 * Usage: `selectTodoById(todoId)` in component init
 * Usage: `selectTodoById.select(state, todoId)` in event handlers
 */
export const selectTodoById = store.createSelector<[todoId: string], Todo | undefined>(
  (state, todoId) => state.todos.todos.map[todoId]
);

/**
 * Derived selector: counts completed todos.
 * Reads from `selectTodos.select(state)` to stay composable.
 */
export const selectCompletedCount = store.createSelector((state) => {
  const todos = selectTodos.select(state);
  const items = getItems(todos);
  return items.filter((todo) => todo.completed).length;
});

/**
 * Returns just the array of todo IDs (useful for list rendering keys).
 */
export const selectTodoIds = store.createSelector((state) => {
  return selectTodos.select(state).ids;
});

