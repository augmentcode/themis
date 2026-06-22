type Collection<T, K extends string> = {
  map: Record<K, T>;
  ids: K[];
  refsCount: Record<K, number>;
};

type Todo = { id: string; title: string };
type TodoId = string;

export type TodosState = {
  todos: Collection<Todo, TodoId>;
  selectedIds: TodoId[];
};