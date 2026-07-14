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

  // Svelte Readable sources are push-only, so active selectors keep only the
  // current source snapshot and compare it with the last emitted value on ticks.
  let latest: { value: T } | null = null;
  let lastEmitted: { value: T } | null = null;

  const store = writable<T>(undefined as T, (set) => {
    let initialized = false;
    let unsubscribeCadence: (() => void) | null = null;

    const stopCheckingOnCadence = () => {
      unsubscribeCadence?.();
      unsubscribeCadence = null;
    };

    const checkLatest = () => {
      if (latest === null || latest.value === lastEmitted?.value) {
        return;
      }
      const { value } = latest;
      lastEmitted = { value };
      set(value);
    };

    const startCheckingOnCadence = () => {
      if (unsubscribeCadence === null) {
        unsubscribeCadence = selectorCadenceSource.subscribe(checkLatest);
      }
    };

    const unsubscribe = source.subscribe((value) => {
      latest = { value };
      if (!initialized) {
        initialized = true;
        lastEmitted = { value };
        set(value);
      }
    });
    startCheckingOnCadence();

    return () => {
      stopCheckingOnCadence();
      unsubscribe();
      latest = null;
      lastEmitted = null;
    };
  });

  return { subscribe: store.subscribe };
}

