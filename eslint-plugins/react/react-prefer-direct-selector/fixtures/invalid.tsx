import { selectTodoById, selectTodos } from "../todos/todos-selectors";

export function TodosPanel() {
  const fallbackTodos = selectTodos.useValue();
  const todos = selectTodos();
  const first = selectTodoById("first");
  const { length } = selectTodos();

  return (
    <p>
      {fallbackTodos.length} {todos.length} {first?.label} {length}
    </p>
  );
}

