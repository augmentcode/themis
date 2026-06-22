import { selectTodos } from "../todos-selectors";

export function handleClick() {
  const todosReadable = selectTodos();
  return todosReadable;
}