export type TodosState = {
  generatedAt: number | null;
  ids: string[];
  events: TodoEvent[];
};

type TodoEvent = { id: string; timestamp: string };

export const initialState: TodosState = {
  generatedAt: null,
  ids: [],
  events: [],
};

export const todoCreated = createAction("todos/create", (text: string) => ({
  id: crypto.randomUUID(),
  generatedAt: Date.now(),
  createdAt: new Date(),
  seed: Math.random(),
  text,
}));

export const todoEventsLoaded = createAction("todos/eventsLoaded");

export const todosReducer = createReducer(initialState)
  .with(todoCreated, (state, action) => ({
    ...state,
    generatedAt: action.payload.generatedAt,
    ids: [...state.ids, action.payload.id],
  }))
  .with(todoEventsLoaded, (state, { payload: [events] }) => {
    const sortedEvents = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return { ...state, events: sortedEvents };
  });