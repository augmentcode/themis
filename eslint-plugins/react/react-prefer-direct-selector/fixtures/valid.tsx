import { selectTodoById, selectTodos } from "../todos/todos-selectors";
import { formatter } from "../utils/formatter";

function TodoSummary({ todosSignal }) {
  return <span>{todosSignal.value.length}</span>;
}

export function TodosPanel() {
  const todos = selectTodos();
  const first = selectTodoById("first");
  const label = formatter.useValue();

  return (
    <section>
      <p>
        {todos.value.length} {first.value?.label} {label}
      </p>
      <TodoSummary todosSignal={todos} />
      <span>{first}</span>
    </section>
  );
}

