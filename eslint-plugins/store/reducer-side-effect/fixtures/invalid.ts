export const initialState = { ids: [] as string[] };

export const todosReducer = createReducer(initialState).with(todoAdded, (state, action) => {
  fetch(`/todos/${action.payload.id}`);
  setTimeout(() => {}, 0);
  localStorage.setItem("todos", "[]");
  window.location.href;
  return {
    ...state,
    ids: [...state.ids, action.payload.id],
    loadedAt: new Date(),
    requestId: crypto.randomUUID(),
    seed: Math.random(),
    promise: new Promise((resolve) => resolve(action.payload.id)),
  };
});