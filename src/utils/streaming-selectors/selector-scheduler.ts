import Kefir, { type Observable } from "kefir";
import {
  createSelectorCadenceSource,
  type SelectorCadenceSource,
} from "../selector-core/throttled-selector-options";

export const createThrottledObservable = <T, E = any>(
  source: Observable<T, E>,
  selectorCadenceSource: SelectorCadenceSource = createSelectorCadenceSource()
): Observable<T, E> => {
  return Kefir.stream<T, E>((emitter) => {
    let initialized = false;
    // Kefir observables are push-only, so active selectors keep only the current
    // source snapshot and compare it with the last emitted value on cadence ticks.
    let latest: { value: T } | null = null;
    let lastEmitted: { value: T } | null = null;
    let ended = false;
    let unsubscribeCadence: (() => void) | null = null;

    const stopCheckingOnCadence = () => {
      unsubscribeCadence?.();
      unsubscribeCadence = null;
    };

    const startCheckingOnCadence = () => {
      if (unsubscribeCadence === null) {
        unsubscribeCadence = selectorCadenceSource.subscribe(checkLatest);
      }
    };

    const finishIfNeeded = () => {
      if (ended) {
        emitter.end();
      }
    };

    const hasChangedLatest = () => latest !== null && latest.value !== lastEmitted?.value;

    const emit = (value: T) => {
      lastEmitted = { value };
      emitter.value(value);
    };

    function checkLatest() {
      if (latest !== null && latest.value !== lastEmitted?.value) {
        emit(latest.value);
      }
      if (!hasChangedLatest()) {
        finishIfNeeded();
      }
    }

    const subscription = source.observe({
      value(value) {
        latest = { value };
        if (!initialized) {
          initialized = true;
          emit(value);
        }
      },
      error(error) {
        emitter.error(error);
      },
      end() {
        ended = true;
        if (!hasChangedLatest()) {
          finishIfNeeded();
        }
      },
    });
    if (!ended || hasChangedLatest()) {
      startCheckingOnCadence();
    }

    return () => {
      stopCheckingOnCadence();
      latest = null;
      lastEmitted = null;
      ended = true;
      subscription.unsubscribe();
    };
  });
};