import { appStore, unrelatedStore } from "./type-aware-store";

const { createSelector: createStoreSelector } = appStore;

const importedStoreSelector = appStore.createSelector((state) => state);
const importedBareSelector = createStoreSelector((state) => state);
const importedUnrelatedSelector = unrelatedStore.createSelector((state) => state);

export function* todosSaga() {
  return { importedStoreSelector, importedBareSelector, importedUnrelatedSelector };
}