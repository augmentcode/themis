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
    let latest: { value: T } | null = null;
    let pending: { value: T } | null = null;
    let ended = false;
    let unsubscribeCadence: (() => void) | null = null;

    const clearScheduledFlush = () => {
      unsubscribeCadence?.();
      unsubscribeCadence = null;
    };

    const scheduleFlush = () => {
      if (unsubscribeCadence === null) {
        unsubscribeCadence = selectorCadenceSource.subscribe(flushLatest);
      }
    };

    const finishIfNeeded = () => {
      if (ended) {
        emitter.end();
      }
    };

    const flushLatest = () => {
      if (pending !== null) {
        const { value } = pending;
        pending = null;
        emitter.value(value);
      }
      if (pending === null) {
        clearScheduledFlush();
        finishIfNeeded();
      }
    };

    const subscription = source.observe({
      value(value) {
        if (value === latest?.value) {
          return;
        }
        latest = { value };
        if (!initialized) {
          initialized = true;
          emitter.value(value);
          return;
        }
        pending = { value };
        scheduleFlush();
      },
      error(error) {
        emitter.error(error);
      },
      end() {
        ended = true;
        if (pending !== null) {
          scheduleFlush();
          return;
        }
        finishIfNeeded();
      },
    });

    return () => {
      clearScheduledFlush();
      latest = null;
      pending = null;
      ended = true;
      subscription.unsubscribe();
    };
  });
};