export type TodosState = {
  loadedAtIso: string;
  errorMessage: string | null;
  ids: string[];
};

export const initialState: TodosState = {
  loadedAtIso: "",
  errorMessage: null,
  ids: [],
};