export const initialState = {
  generatedAt: Date.now(),
  clientId: crypto.randomUUID(),
  ids: [] as string[],
  lastSeenAt: null as Date | null,
};

export const todoSeen = createAction("todos/seen");

export const todosReducer = createReducer(initialState)
  .with(todoCreated, (state) => ({
    ...state,
    generatedAt: Date.now(),
    clientId: crypto.randomUUID(),
    createdAt: new Date(),
    seed: Math.random(),
  }))
  .with(todoSeen, (state, { payload: [todo] }) => ({
    ...state,
    lastSeenAt: new Date(todo.timestamp),
  }));