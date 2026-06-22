import { selectTodos } from "../todos/todos-selectors";
import { formatter } from "../utils/formatter";

export function TodosPanel() {
  const todos = selectTodos();
  const label = formatter.useValue();

  return (
    <p>
      {todos.value.length} {label}
    </p>
  );
}

