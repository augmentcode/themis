export type TodosState = {
  loadedAtIso: string;
  retryCount: number;
  byId: Record<string, { id: string; title: string }>;
};