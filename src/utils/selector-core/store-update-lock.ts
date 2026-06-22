import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";

type StoreUtilityLockState = {
  [INTERNAL_STORE_UTILITY_DOMAIN]?: {
    updatesLocked?: boolean;
  };
};

export const areStoreUpdatesLocked = (state: unknown): boolean => {
  if (state === null || typeof state !== "object") {
    return false;
  }

  return (state as StoreUtilityLockState)[INTERNAL_STORE_UTILITY_DOMAIN]?.updatesLocked === true;
};