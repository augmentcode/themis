import { createSelectorFromReadableState } from "../../utils/svelte-selectors/create-selector";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../../constants";
import type { StoreUtilityState } from "./store-utility-slice";
import type { StoreReadableStateSource } from "../../types";

const selectUpdatesLockedCallback = (state: Record<string, any>) => {
  const storeUtilityState = state[INTERNAL_STORE_UTILITY_DOMAIN] as StoreUtilityState | undefined;
  return storeUtilityState?.updatesLocked === true;
};

const unboundStoreUtilityStateSource: StoreReadableStateSource<Record<string, any>> = {
  getStateObservable() {
    throw new Error("selectUpdatesLocked readable usage requires a Store-bound selector.");
  },
};

export const selectUpdatesLocked = createSelectorFromReadableState(
  unboundStoreUtilityStateSource,
  selectUpdatesLockedCallback
);

