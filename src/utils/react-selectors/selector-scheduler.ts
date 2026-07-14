import { signal, type ReadonlySignal, type Signal } from "@preact/signals-react";
import {
  createSelectorCadenceSource,
  type SelectorCadenceSource,
} from "../selector-core/throttled-selector-options";

const unsetValue = Symbol("unset-throttled-signal-value");

/** @deprecated Store-created selectors now derive from cadenced Store state signals. */
export const createThrottledSignal = <T>(
  source: ReadonlySignal<T>,
  selectorCadenceSource: SelectorCadenceSource = createSelectorCadenceSource()
): ReadonlySignal<T> => {
  let lastEmitted: T = source.value;
  let unsubscribeCadence: (() => void) | null = null;
  let output!: Signal<T>;

  const emit = (value: T) => {
    lastEmitted = value;
    output.value = value;
  };

  const stopCheckingOnCadence = () => {
    unsubscribeCadence?.();
    unsubscribeCadence = null;
  };

  const checkSourceValue = () => {
    const value = source.value;
    if (value !== lastEmitted) {
      emit(value);
    }
  };

  const startCheckingOnCadence = () => {
    if (unsubscribeCadence === null) {
      unsubscribeCadence = selectorCadenceSource.subscribe(checkSourceValue);
    }
  };

  output = signal(source.value, {
    watched() {
      lastEmitted = source.value;
      output.value = lastEmitted;
      startCheckingOnCadence();
    },
    unwatched() {
      stopCheckingOnCadence();
    },
  });

  return output;
};