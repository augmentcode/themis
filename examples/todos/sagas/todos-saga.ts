/**
 * Todos Saga — practical localStorage persistence for the todos example.
 *
 * The saga loads saved todos once on startup, then saves the current todo list
 * after actions that change it. Safe localStorage helpers keep browser storage
 * errors from breaking the app.
 */

import { put, takeEvery, select } from "typed-redux-saga";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { getItems, type Collection } from "@augmentcode/themis/utils/collections/collection-utils";
import { getLocalStorageJSON, setLocalStorageJSON } from "../../utils/safe-local-storage-saga";
import {
  addTodo,
  clearCompleted,
  removeTodo,
  renameTodo,
  setTodos,
  toggleTodo,
  type Todo,
  type TodosState,
} from "../todos-slice";

type TodosSagaState = {
  todos: TodosState;
};

// --- Saga actions ---

/** Trigger initial load of todos from localStorage */
export const loadTodos = createAction("todos/loadTodos");

const STORAGE_KEY = "themis-todos";

const selectTodos = (state: TodosSagaState): Collection<Todo, "id"> => state.todos.todos;

// --- Worker sagas ---

/**
 * Loads todos from localStorage and dispatches setTodos to hydrate state.
 * Uses the safe localStorage JSON helper so storage errors are swallowed.
 */
function* handleLoadTodos() {
  try {
    const stored = yield* getLocalStorageJSON<Todo[]>(STORAGE_KEY);
    if (stored && stored.length > 0) {
      yield* put(setTodos(stored));
    }
  } catch (e) {
    console.error("[Todos Saga] Error loading todos:", e);
  }
}

/**
 * Saves current todos to localStorage.
 * Called after todo mutation actions so it persists the latest store state.
 */
function* handlePersistTodos() {
  try {
    const todosCollection = yield* select(selectTodos);
    const items = getItems(todosCollection);
    yield* setLocalStorageJSON(STORAGE_KEY, items);
  } catch (e) {
    console.error("[Todos Saga] Error persisting todos:", e);
  }
}

// --- Root saga ---

/**
 * The root todos saga sets up:
 * 1. A one-shot load from localStorage on `loadTodos` action
 * 2. Direct persistence after actions that modify todos
 */
export function* todosSaga() {
  yield* takeEvery(loadTodos, handleLoadTodos);

  yield* takeEvery(addTodo, handlePersistTodos);
  yield* takeEvery(removeTodo, handlePersistTodos);
  yield* takeEvery(toggleTodo, handlePersistTodos);
  yield* takeEvery(renameTodo, handlePersistTodos);
  yield* takeEvery(clearCompleted, handlePersistTodos);
}

