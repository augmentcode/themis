import type {
  SelectorTraceInvalidationReason,
  SelectorTraceResultOutcome,
  SelectorTraceSelectorSummary,
  SelectorTraceSummary,
} from './types';
import type { CachedSelector, SelectorTrace } from './utils/types';

const MAX_DURATION_SAMPLES = 64;

type MutableSelectorSummary = {
  selectorSource: string;
  executionCount: number;
  recomputationCount: number;
  invalidationReasons: Record<SelectorTraceInvalidationReason, number>;
  resultOutcomes: Record<SelectorTraceResultOutcome, number>;
  durationCount: number;
  durationTotalMs: number;
  durationMaximumMs: number;
  durationSamples: number[];
  nextDurationSample: number;
  cacheRequestCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
};

const EMPTY_SELECTOR_TRACE_SUMMARY = Object.freeze([]) as SelectorTraceSummary;

const createMutableSummary = (selectorSource: string): MutableSelectorSummary => ({
  selectorSource,
  executionCount: 0,
  recomputationCount: 0,
  invalidationReasons: {
    'first-execution': 0,
    'selector-arguments-changed': 0,
    'accessed-state-paths-changed': 0,
    'previous-result-unavailable': 0,
  },
  resultOutcomes: {
    initial: 0,
    changed: 0,
    'retained-reference': 0,
  },
  durationCount: 0,
  durationTotalMs: 0,
  durationMaximumMs: 0,
  durationSamples: [],
  nextDurationSample: 0,
  cacheRequestCount: 0,
  cacheHitCount: 0,
  cacheMissCount: 0,
});

const addDuration = (summary: MutableSelectorSummary, durationMs: number): void => {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;

  summary.executionCount += 1;
  summary.durationCount += 1;
  summary.durationTotalMs += durationMs;
  summary.durationMaximumMs = Math.max(summary.durationMaximumMs, durationMs);
  if (summary.durationSamples.length < MAX_DURATION_SAMPLES) {
    summary.durationSamples.push(durationMs);
    return;
  }

  summary.durationSamples[summary.nextDurationSample] = durationMs;
  summary.nextDurationSample = (summary.nextDurationSample + 1) % MAX_DURATION_SAMPLES;
};

const getPercentile95 = (samples: readonly number[]): number => {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
};

const createSnapshotEntry = (summary: MutableSelectorSummary): SelectorTraceSelectorSummary => {
  const invalidationReasons = Object.freeze({ ...summary.invalidationReasons });
  const resultOutcomes = Object.freeze({ ...summary.resultOutcomes });
  const duration = Object.freeze({
    count: summary.durationCount,
    totalMs: summary.durationTotalMs,
    averageMs: summary.durationCount === 0 ? 0 : summary.durationTotalMs / summary.durationCount,
    maximumMs: summary.durationMaximumMs,
    p95Ms: getPercentile95(summary.durationSamples),
  });
  const cache = Object.freeze({
    requestCount: summary.cacheRequestCount,
    hitCount: summary.cacheHitCount,
    missCount: summary.cacheMissCount,
    hitRatio:
      summary.cacheRequestCount === 0
        ? null
        : summary.cacheHitCount / summary.cacheRequestCount,
  });

  return Object.freeze({
    selectorSource: summary.selectorSource,
    executionCount: summary.executionCount,
    recomputationCount: summary.recomputationCount,
    invalidationReasons,
    resultOutcomes,
    duration,
    cache,
  });
};

export class SelectorTraceSummaryCollector {
  private readonly summaries = new Map<CachedSelector<any, any, any[]>, MutableSelectorSummary>();

  constructor(
    private readonly getSelectorSource: (selector: CachedSelector<any, any, any[]>) => string
  ) {}

  record(trace: SelectorTrace<any, any, any[]>): void {
    let summary = this.summaries.get(trace.selectorFunc);
    if (!summary) {
      summary = createMutableSummary(this.getSelectorSource(trace.selectorFunc));
      this.summaries.set(trace.selectorFunc, summary);
    }

    if ('observableCacheRequestCount' in trace) {
      summary.cacheRequestCount += 1;
      if (trace.outputCacheStatus === 'hit') summary.cacheHitCount += 1;
      else summary.cacheMissCount += 1;
      return;
    }

    summary.recomputationCount += 1;
    if (trace.executionDurationMs !== undefined) addDuration(summary, trace.executionDurationMs);
    if (trace.invalidationReason) summary.invalidationReasons[trace.invalidationReason] += 1;
    if (trace.resultOutcome) summary.resultOutcomes[trace.resultOutcome] += 1;
  }

  snapshot(): SelectorTraceSummary {
    if (this.summaries.size === 0) return EMPTY_SELECTOR_TRACE_SUMMARY;
    return Object.freeze(Array.from(this.summaries.values(), createSnapshotEntry));
  }
}

export const getEmptySelectorTraceSummary = (): SelectorTraceSummary =>
  EMPTY_SELECTOR_TRACE_SUMMARY;