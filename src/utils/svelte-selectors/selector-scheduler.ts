import { type Readable, writable } from "svelte/store";
import {
  createSelectorFlushManager,
  type SelectorFlushManager,
} from "../selector-core/throttled-selector-options";

// ── Throttled readable factory ──────────────────────────────────────
export function createThrottledReadable<T>(
  source: Readable<T>,
  selectorFlushManager: SelectorFlushManager = createSelectorFlushManager()
): Readable<T> {

  let latest: { value: T } | null = null;

  const store = writable<T>(undefined as T, (set) => {
    let initialized = false;

    const flushLatest = () => {
      if (latest !== null) {
        const { value } = latest;
        set(value);
      }
    };

    const unsubscribe = source.subscribe((value) => {
      if (value === latest?.value) {
        return;
      }
      latest = { value };
      if (!initialized) {
        initialized = true;
        flushLatest();
        return;
      }
      selectorFlushManager.requestFlush(flushLatest);
    });

    return () => {
      selectorFlushManager.cancelFlush(flushLatest);
      unsubscribe();
      latest = null;
    };
  });

  return { subscribe: store.subscribe };
}

