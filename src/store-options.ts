import type {
  NormalizedSelectorTracingOptions,
  NormalizedStoreOptions,
  SelectorTracingOptions,
  StoreOptions,
} from './types';
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

export const DEFAULT_SELECTOR_TRACE_MIN_DURATION_MS = 0;
export const DEFAULT_SELECTOR_TRACE_MIN_RECOMPUTATION_COUNT = 0;
export const DEFAULT_SELECTOR_TRACE_MIN_CACHE_MISS_COUNT = 0;
export const DEFAULT_SELECTOR_TRACE_SUMMARY_INTERVAL_MS = 1000;

const TRACE_OPTION_KEYS = new Set<keyof SelectorTracingOptions>([
  'traceExecution',
  'traceCache',
  'traceInvalidation',
  'traceArguments',
  'traceResults',
  'traceCadence',
  'minDurationMs',
  'minRecomputationCount',
  'minCacheMissCount',
  'summaryEnabled',
  'summaryIntervalMs',
]);

const disabledSelectorTracingOptions = (): NormalizedSelectorTracingOptions => ({
  traceExecution: false,
  traceCache: false,
  traceInvalidation: false,
  traceArguments: false,
  traceResults: false,
  traceCadence: false,
  minDurationMs: DEFAULT_SELECTOR_TRACE_MIN_DURATION_MS,
  minRecomputationCount: DEFAULT_SELECTOR_TRACE_MIN_RECOMPUTATION_COUNT,
  minCacheMissCount: DEFAULT_SELECTOR_TRACE_MIN_CACHE_MISS_COUNT,
  summaryEnabled: false,
  summaryIntervalMs: DEFAULT_SELECTOR_TRACE_SUMMARY_INTERVAL_MS,
});

const validateSelectorTracingNumber = (name: string, value: unknown, minimum: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new RangeError(
      `Store option "${name}" must be a finite number greater than or equal to ${minimum}. Received ${String(value)}.`
    );
  }
  return value;
};

export const normalizeSelectorTracingOptions = (
  tracing: StoreOptions['traceSelectors']
): NormalizedSelectorTracingOptions => {
  if (tracing === undefined || tracing === false) {
    return disabledSelectorTracingOptions();
  }

  if (tracing === true) {
    return {
      traceExecution: true,
      traceCache: true,
      traceInvalidation: true,
      traceArguments: true,
      traceResults: true,
      traceCadence: true,
      minDurationMs: DEFAULT_SELECTOR_TRACE_MIN_DURATION_MS,
      minRecomputationCount: DEFAULT_SELECTOR_TRACE_MIN_RECOMPUTATION_COUNT,
      minCacheMissCount: DEFAULT_SELECTOR_TRACE_MIN_CACHE_MISS_COUNT,
      summaryEnabled: false,
      summaryIntervalMs: DEFAULT_SELECTOR_TRACE_SUMMARY_INTERVAL_MS,
    };
  }

  if (typeof tracing !== 'object' || tracing === null || Array.isArray(tracing)) {
    throw new TypeError('Store option "traceSelectors" must be a boolean or a flat configuration object.');
  }

  for (const key of Object.keys(tracing)) {
    if (!TRACE_OPTION_KEYS.has(key as keyof SelectorTracingOptions)) {
      throw new TypeError(`Store option "traceSelectors.${key}" is not supported.`);
    }
  }

  for (const key of [
    'traceExecution',
    'traceCache',
    'traceInvalidation',
    'traceArguments',
    'traceResults',
    'traceCadence',
    'summaryEnabled',
  ] as const) {
    const value = tracing[key];
    if (value !== undefined && typeof value !== 'boolean') {
      throw new TypeError(`Store option "traceSelectors.${key}" must be a boolean.`);
    }
  }

  return {
    traceExecution: tracing.traceExecution === true,
    traceCache: tracing.traceCache === true,
    traceInvalidation: tracing.traceInvalidation === true,
    traceArguments: tracing.traceArguments === true,
    traceResults: tracing.traceResults === true,
    traceCadence: tracing.traceCadence === true,
    minDurationMs: validateSelectorTracingNumber(
      'traceSelectors.minDurationMs',
      tracing.minDurationMs ?? DEFAULT_SELECTOR_TRACE_MIN_DURATION_MS,
      0
    ),
    minRecomputationCount: validateSelectorTracingNumber(
      'traceSelectors.minRecomputationCount',
      tracing.minRecomputationCount ?? DEFAULT_SELECTOR_TRACE_MIN_RECOMPUTATION_COUNT,
      0
    ),
    minCacheMissCount: validateSelectorTracingNumber(
      'traceSelectors.minCacheMissCount',
      tracing.minCacheMissCount ?? DEFAULT_SELECTOR_TRACE_MIN_CACHE_MISS_COUNT,
      0
    ),
    summaryEnabled: tracing.summaryEnabled === true,
    summaryIntervalMs: validateSelectorTracingNumber(
      'traceSelectors.summaryIntervalMs',
      tracing.summaryIntervalMs ?? DEFAULT_SELECTOR_TRACE_SUMMARY_INTERVAL_MS,
      0
    ),
  };
};

export const normalizeStoreOptions = (options: StoreOptions = {}): NormalizedStoreOptions => ({
  throttledSelectorFrequency: validateThrottledSelectorFrequency(
    options.throttledSelectorFrequency ?? DEFAULT_THROTTLED_SELECTOR_FREQUENCY
  ),
  sagaMonitor: options.sagaMonitor === true,
  logReduxActions: options.logReduxActions === true,
  traceSelectors: normalizeSelectorTracingOptions(options.traceSelectors),
});