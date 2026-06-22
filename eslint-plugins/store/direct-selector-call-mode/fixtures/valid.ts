import { selectTodos } from "../todos-selectors";

export function handleClick(store) {
  return selectTodos.select(store.state);
}