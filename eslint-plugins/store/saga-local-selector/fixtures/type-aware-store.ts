import { Store } from "@augmentcode/themis/svelte-store";

export const appStore = new Store();

class UnrelatedStore {
  createSelector<T>(callback: (state: unknown) => T) {
    return callback;
  }
}

export const unrelatedStore = new UnrelatedStore();