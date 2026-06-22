import { selectTodos } from "../selectors/todos-selectors";

export function TodoList() {
  const todos = selectTodos.useValue();
  return <ul>{todos.map((todo) => <li key={todo.id}>{todo.label}</li>)}</ul>;
}

