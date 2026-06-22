import { signal, type ReadonlySignal, type Signal } from "@preact/signals-react";
import {
  createSelectorFlushManager,
  type SelectorFlushManager,
} from "../selector-core/throttled-selector-options";

const unsetValue = Symbol("unset-throttled-signal-value");

export const createThrottledSignal = <T>(
  source: ReadonlySignal<T>,
  selectorFlushManager: SelectorFlushManager = createSelectorFlushManager()
): ReadonlySignal<T> => {
  let latest: { value: T } | null = null;
  let isScheduled = false;
  let unsubscribeSource: (() => void) | null = null;
  let output!: Signal<T>;

  const emit = (value: T) => {
    output.value = value;
  };

  const flushLatest = () => {
    isScheduled = false;
    if (latest === null) {
      return;
    }
    const { value } = latest;
    output.value = value;
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
        selectorFlushManager.requestFlush(flushLatest);
      });
    },
    unwatched() {
      unsubscribeSource?.();
      unsubscribeSource = null;
      selectorFlushManager.cancelFlush(flushLatest);
      latest = null;
      isScheduled = false;
    },
  });

  return output;
};