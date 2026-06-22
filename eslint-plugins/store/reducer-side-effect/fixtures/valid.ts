export const initialState = { ids: [] as string[] };

export const todoAdded = createAction("todos/add", (text: string) => {
  fetch("/todos/prepare?text=" + text);
  const payload = { id: crypto.randomUUID(), tags: [] as string[], touchedAt: Date.now() };
  payload.tags.push(text);
  return { payload };
});

export const todosReducer = createReducer(initialState).with(todoAdded, (state, action) => {
  return { ...state, ids: [...state.ids, action.payload.id] };
});