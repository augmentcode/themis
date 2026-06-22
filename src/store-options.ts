import type { NormalizedStoreOptions, StoreOptions } from './types';
import {
  DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  validateThrottledSelectorFrequency,
} from './utils/selector-core/throttled-selector-options';

export {
  DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  MIN_THROTTLED_SELECTOR_FREQUENCY,
  MAX_THROTTLED_SELECTOR_FREQUENCY,
  validateThrottledSelectorFrequency,
} from './utils/selector-core/throttled-selector-options';

export const normalizeStoreOptions = (options: StoreOptions = {}): NormalizedStoreOptions => ({
  throttledSelectorFrequency: validateThrottledSelectorFrequency(
    options.throttledSelectorFrequency ?? DEFAULT_THROTTLED_SELECTOR_FREQUENCY
  ),
  sagaMonitor: options.sagaMonitor === true,
  traceSelectors: options.traceSelectors === true,
});