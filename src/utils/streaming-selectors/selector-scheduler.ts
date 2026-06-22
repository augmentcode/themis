import Kefir, { type Observable } from "kefir";
import {
  createSelectorFlushManager,
  type SelectorFlushManager,
} from "../selector-core/throttled-selector-options";

export const createThrottledObservable = <T, E = any>(
  source: Observable<T, E>,
  selectorFlushManager: SelectorFlushManager = createSelectorFlushManager()
): Observable<T, E> => {
  return Kefir.stream<T, E>((emitter) => {
    let initialized = false;
    let latest: { value: T } | null = null;
    let ended = false;

    const finishIfNeeded = () => {
      if (ended) {
        emitter.end();
      }
    };

    const flushLatest = () => {
      if (latest !== null) {
        const { value } = latest;
        emitter.value(value);
      }
      finishIfNeeded();
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
        selectorFlushManager.requestFlush(flushLatest);
      },
      error(error) {
        emitter.error(error);
      },
      end() {
        ended = true;
        if (latest !== null) {
          selectorFlushManager.requestFlush(flushLatest);
          return;
        }
        finishIfNeeded();
      },
    });

    return () => {
      selectorFlushManager.cancelFlush(flushLatest);
      latest = null;
      ended = true;
      subscription.unsubscribe();
    };
  });
};