import { selectTodoById, selectTodos } from "../todos/todos-selectors";

export function TodosPanel() {
  const todos = selectTodos.useValue();
  const first = selectTodoById.useValue("first");

  return (
    <p>
      {todos.length} {first?.label}
    </p>
  );
}

