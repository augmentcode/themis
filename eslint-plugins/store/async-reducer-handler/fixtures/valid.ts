export const initialState = { ids: [] as string[] };

export const todosReducer = createReducer(initialState).with(todoAdded, (state, action) => ({
  ...state,
  ids: [...state.ids, action.payload.id],
}));