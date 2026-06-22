import { createSelectorFromReadableState } from "../../utils/svelte-selectors/create-selector";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../../constants";
import type { StoreUtilityState } from "./store-utility-slice";

const selectUpdatesLockedCallback = (state: Record<string, any>) => {
  const storeUtilityState = state[INTERNAL_STORE_UTILITY_DOMAIN] as StoreUtilityState | undefined;
  return storeUtilityState?.updatesLocked === true;
};

export const selectUpdatesLocked = createSelectorFromReadableState(
  () => {
    throw new Error("selectUpdatesLocked readable usage requires a Store-bound selector.");
  },
  selectUpdatesLockedCallback
);

