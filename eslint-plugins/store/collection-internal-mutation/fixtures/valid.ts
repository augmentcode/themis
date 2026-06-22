export function replaceTodoInsideCollectionUtility(collection: Collection<Todo, string>, todo: Todo) {
  collection.map[todo.id] = todo;
  collection.ids.push(todo.id);
}