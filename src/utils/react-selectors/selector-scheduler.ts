import { signal, type ReadonlySignal, type Signal } from "@preact/signals-react";
import {
  createSelectorCadenceSource,
  type SelectorCadenceSource,
} from "../selector-core/throttled-selector-options";

const unsetValue = Symbol("unset-throttled-signal-value");

export const createThrottledSignal = <T>(
  source: ReadonlySignal<T>,
  selectorCadenceSource: SelectorCadenceSource = createSelectorCadenceSource()
): ReadonlySignal<T> => {
  let latest: { value: T } | null = null;
  let pending: { value: T } | null = null;
  let unsubscribeCadence: (() => void) | null = null;
  let unsubscribeSource: (() => void) | null = null;
  let output!: Signal<T>;

  const emit = (value: T) => {
    output.value = value;
  };

  const clearScheduledFlush = () => {
    unsubscribeCadence?.();
    unsubscribeCadence = null;
  };

  const scheduleFlush = () => {
    if (unsubscribeCadence === null) {
      unsubscribeCadence = selectorCadenceSource.subscribe(flushLatest);
    }
  };

  const flushLatest = () => {
    if (pending !== null) {
      const { value } = pending;
      pending = null;
      output.value = value;
    }
    if (pending === null) {
      clearScheduledFlush();
    }
  };

  output = signal(source.value, {
    watched() {
      if (unsubscribeSource !== null) {
        return;
      }
      let initialized = false;
      unsubscribeSource = source.subscribe((value) => {
        if (value === latest?.value) {
          return;
        }
        latest = { value };
        if (!initialized) {
          initialized = true;
          emit(value);
          return;
        }
        pending = { value };
        scheduleFlush();
      });
    },
    unwatched() {
      unsubscribeSource?.();
      unsubscribeSource = null;
      clearScheduledFlush();
      latest = null;
      pending = null;
    },
  });

  return output;
};