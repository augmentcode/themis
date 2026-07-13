import { waitFor, takeEveryFromSelector } from "@augmentcode/themis/saga";
import { selectTodoById, selectTodosByFilter } from "../todos/todos-selectors";

export const selectTodoByObject = store.createSelector((state, { id }) => state.todos.map[id]);
export const selectTodoByTuple = store.createSelector((state, [id]) => state.todos.map[id]);
export const selectLocalTodo = store.createSelector((state, id: string) => state.todos.map[id]);

function* todoWorker() {}

export function useUnstableSelectorArgs(state, todoId, filter, source) {
  selectTodoById({ id: todoId });
  selectTodoById([todoId]);
  selectTodoById(() => todoId);
  selectTodoById(class TodoKey {});
  selectTodoById(new TodoKey(todoId));
  selectTodoById(...[{ id: todoId }]);
  selectTodosByFilter.select(state, { filter });
  selectTodosByFilter.effect({ filter });
  selectTodosByFilter.useValue({ filter });
  selectTodosByFilter.withStore(source)({ filter });
  selectLocalTodo({ id: todoId });
}

export function* watchUnstableSelectorArgs(filter) {
  yield* takeEveryFromSelector(selectTodosByFilter, [{ filter }], todoWorker);
  yield* waitFor(selectTodosByFilter, [{ filter }], (todos) => todos.length > 0, 5000);
}