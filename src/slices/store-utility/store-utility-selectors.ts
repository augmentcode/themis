import { INTERNAL_STORE_UTILITY_DOMAIN } from "../../constants";
import type { StoreUtilityState } from "./store-utility-slice";
import { select } from "typed-redux-saga";

const selectUpdatesLockedCallback = (state: Record<string, any>) => {
  const storeUtilityState = state[INTERNAL_STORE_UTILITY_DOMAIN] as StoreUtilityState | undefined;
  return storeUtilityState?.updatesLocked === true;
};

type SelectorFactory<Selector> = {
  createSelector(selectorFunc: typeof selectUpdatesLockedCallback): Selector;
};

const bindUpdatesLockedSelector = <Selector>(store: SelectorFactory<Selector>): Selector =>
  store.createSelector(selectUpdatesLockedCallback);

export const selectUpdatesLocked = Object.assign(
  () => {
    throw new Error("selectUpdatesLocked readable usage requires a Store-bound selector.");
  },
  {
    withStore: bindUpdatesLockedSelector,
    select: selectUpdatesLockedCallback,
    effect: () => select(selectUpdatesLockedCallback),
  }
);

