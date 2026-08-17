import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingStore } from './streaming-store';

const isProductionBuild =
  (import.meta as ImportMeta & { readonly env: { readonly PROD: boolean } }).env.PROD;

const counterReducer = Object.assign(
  (state = { count: 0 }) => state,
  { initialState: { count: 0 } }
);

describe.runIf(isProductionBuild)('production selector tracing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('activates tracing and summaries through the Store option in production', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const store = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { traceSelectors: { traceExecution: true, traceCache: true, summaryEnabled: true } }
    );
    const selectCount = store.createSelector((state) => state.counter.count);

    store.traceSelectors();
    const dispose = store.init();
    const subscription = selectCount().observe(() => undefined);
    subscription.unsubscribe();

    expect(store.getSelectorTraceReporter()).toEqual(expect.any(Function));
    expect('getSelectorExecutionTraceReporter' in store).toBe(false);
    expect('getSelectorComputationTraceOptions' in store).toBe(false);
    expect('getSelectorCacheTraceReporter' in store).toBe(false);
    expect(store.shouldTraceSelectorCache()).toBe(true);
    expect((store as any).selectorTraceSummaryCollector).toBeDefined();
    expect((store as any).selectorTraceSummaryInterval).toBeDefined();
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(consoleInfo).toHaveBeenCalledWith(
      '[themis] selector trace',
      expect.objectContaining({ selectorSource: expect.any(String) })
    );
    expect(store.getSelectorTraceSummary()).not.toEqual([]);

    dispose();

    expect((store as any).selectorTraceSummaryInterval).toBeUndefined();
  });
});