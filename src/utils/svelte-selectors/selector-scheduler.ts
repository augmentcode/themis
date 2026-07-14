import { type Readable, writable } from "svelte/store";
import {
  createSelectorCadenceSource,
  type SelectorCadenceSource,
} from "../selector-core/throttled-selector-options";

// ── Throttled readable factory ──────────────────────────────────────
export function createThrottledReadable<T>(
  source: Readable<T>,
  selectorCadenceSource: SelectorCadenceSource = createSelectorCadenceSource()
): Readable<T> {

  let latest: { value: T } | null = null;
  let pending: { value: T } | null = null;

  const store = writable<T>(undefined as T, (set) => {
    let initialized = false;
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

    const flushLatest = () => {
      if (pending !== null) {
        const { value } = pending;
        pending = null;
        set(value);
      }
      if (pending === null) {
        clearScheduledFlush();
      }
    };

    const unsubscribe = source.subscribe((value) => {
      if (value === latest?.value) {
        return;
      }
      latest = { value };
      if (!initialized) {
        initialized = true;
        set(value);
        return;
      }
      pending = { value };
      scheduleFlush();
    });

    return () => {
      clearScheduledFlush();
      unsubscribe();
      latest = null;
      pending = null;
    };
  });

  return { subscribe: store.subscribe };
}

