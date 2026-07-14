import { createSelectorFromReadableState } from "../../utils/svelte-selectors/create-selector";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../../constants";
import type { StoreUtilityState } from "./store-utility-slice";
import type { StoreRuntimeSelectorSource, StoreSelector } from "../../types";
import { select } from "typed-redux-saga";

const selectUpdatesLockedCallback = (state: Record<string, any>) => {
  const storeUtilityState = state[INTERNAL_STORE_UTILITY_DOMAIN] as StoreUtilityState | undefined;
  return storeUtilityState?.updatesLocked === true;
};

export const selectUpdatesLocked = Object.assign(
  () => {
    throw new Error("selectUpdatesLocked readable usage requires a Store-bound selector.");
  },
  {
    withStore: (store: StoreRuntimeSelectorSource<Record<string, any>>) => createSelectorFromReadableState(store, selectUpdatesLockedCallback),
    select: selectUpdatesLockedCallback,
    effect: () => select(selectUpdatesLockedCallback),
  }
) satisfies StoreSelector<boolean, [], Record<string, any>>;

