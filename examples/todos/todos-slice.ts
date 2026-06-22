/**
 * Todos Slice — demonstrates Collection-based state patterns:
 *
 * - `Collection` type for normalized entity storage (O(1) lookups by ID)
 * - `createCollection` to initialize an empty collection
 * - `addItem`, `removeItem`, `updateItem` for immutable CRUD operations
 * - Actions with tuple payloads for multiple arguments
 *
 * Collections store entities as `{ ids: [...], map: { [id]: entity } }`.
 * This is the recommended pattern for any list of entities that need ID-based access.
 */

import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import {
  type Collection,
  createCollection,
  addItem,
  removeItem,
  updateItem,
  filterCollection,
} from "@augmentcode/themis/utils/collections/collection-utils";

// --- Types ---

export type Todo = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
};

export type TodosState = {
  todos: Collection<Todo, "id">;
};

// --- Initial state ---
// createCollection<ItemType, "idField">("idField") creates an empty normalized collection

const initialState: TodosState = {
  todos: createCollection<Todo, "id">("id"),
};

// --- Actions ---
// Tuple types [arg1: Type, arg2: Type] define the action payload shape.
// The reducer receives them as `action.payload[0]`, `action.payload[1]`, etc.

/** Add a new todo item */
export const addTodo = createAction<[todo: Todo]>("todos/addTodo");

/** Remove a todo by its ID */
export const removeTodo = createAction<[todoId: string]>("todos/removeTodo");

/** Toggle the completed status of a todo */
export const toggleTodo = createAction<[todoId: string]>("todos/toggleTodo");

/** Rename a todo */
export const renameTodo = createAction<[todoId: string, newTitle: string]>("todos/renameTodo");

/** Remove all completed todos */
export const clearCompleted = createAction("todos/clearCompleted");

/** Replace entire todos collection (e.g., from localStorage restore) */
export const setTodos = createAction<[todos: Todo[]]>("todos/setTodos");

// --- Reducer ---

export const todosReducer = createReducer<TodosState>(initialState);

todosReducer.with(addTodo, (state, action) => ({
    ...state,
    todos: addItem(state.todos, action.payload[0]),
  }));
todosReducer.with(removeTodo, (state, action) => ({
    ...state,
    todos: removeItem(state.todos, action.payload[0]),
  }));
todosReducer.with(toggleTodo, (state, action) => ({
    ...state,
    // updateItem merges partial fields with the existing item
    todos: updateItem(state.todos, {
      id: action.payload[0],
      completed: !state.todos.map[action.payload[0]]?.completed,
    } as Partial<Todo> & Pick<Todo, "id">),
  }));
todosReducer.with(renameTodo, (state, action) => ({
    ...state,
    todos: updateItem(state.todos, {
      id: action.payload[0],
      title: action.payload[1],
    } as Partial<Todo> & Pick<Todo, "id">),
  }));
todosReducer.with(clearCompleted, (state) => ({
    ...state,
    // filterCollection returns a new collection with only items that pass the predicate
    todos: filterCollection(state.todos, (todo): todo is Todo => !todo.completed),
  }));
todosReducer.with(setTodos, (state, action) => ({
    ...state,
    todos: createCollection<Todo, "id">("id", action.payload[0]),
  }));

