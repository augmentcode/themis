export const initialState = { ids: [] as string[] };

export const todosReducer = createReducer(initialState).with(todoAdded, async (state, action) => {
  return { ...state, ids: [...state.ids, action.payload.id] };
});