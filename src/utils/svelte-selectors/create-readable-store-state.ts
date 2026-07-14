import { type Readable, readable } from "svelte/store";
import type { ReduxStore } from "../../internal-types";
import type { StoreState } from "../../types";
import {
  createSelectorCadenceSource,
  type SelectorCadenceSource,
} from "../selector-core/throttled-selector-options";

export const createStoreStateReadable = (
  store: ReduxStore,
  selectorCadenceSource: SelectorCadenceSource = createSelectorCadenceSource()
): Readable<StoreState> => {
  const getStoreStateChange = () => {
    return store.getState();
  };

  const storeStartStopNotifier = (set: (val: StoreState) => void): (() => void) => {
    let latest = getStoreStateChange();
    let lastEmitted = latest;
    set(latest);

    const unsubscribeStore = store.subscribe(() => {
      latest = getStoreStateChange();
    });
    const unsubscribeCadence = selectorCadenceSource.subscribe(() => {
      latest = getStoreStateChange();
      if (latest !== lastEmitted) {
        lastEmitted = latest;
        set(latest);
      }
    });

    return () => {
      unsubscribeCadence();
      unsubscribeStore();
    };
  };

  return readable(getStoreStateChange(), storeStartStopNotifier);
};

