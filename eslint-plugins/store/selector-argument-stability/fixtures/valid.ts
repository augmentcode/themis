import { waitFor, takeEveryFromSelector } from "@augmentcode/themis/saga";
import { selectTodoById, selectTodosByFilter } from "../todos/todos-selectors";

const stableFilter = { status: "open" };
const stableArgs = ["first"] as const;
export const selectLocalTodo = store.createSelector((state, todoId: string) => state.todos.map[todoId]);

function* todoWorker() {}

export function useStableSelectorArgs(state, todoId, source, signalArg, readableArg, observableArg) {
  selectTodoById(todoId);
  selectTodoById("first");
  selectTodoById(stableFilter);
  selectTodoById(source.currentFilter);
  selectTodoById(...stableArgs);
  selectTodosByFilter.select(state, todoId, true);
  selectTodosByFilter.effect(todoId, signalArg);
  selectTodosByFilter.useValue(todoId, readableArg);
  selectTodosByFilter.withStore(source)(todoId, observableArg);
  selectLocalTodo(todoId);
}

export function* watchStableSelectorArgs(todoId) {
  yield* takeEveryFromSelector(selectTodosByFilter, [todoId], todoWorker);
  yield* waitFor(selectTodosByFilter, [todoId], (todos) => todos.length > 0, 5000);
}