import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingStore } from './streaming-store';

const isProductionBuild =
  (import.meta as ImportMeta & { readonly env: { readonly PROD: boolean } }).env.PROD;

const counterReducer = Object.assign(
  (state = { count: 0 }) => state,
  { initialState: { count: 0 } }
);

describe.runIf(isProductionBuild)('production selector tracing guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cannot activate tracing or summaries through the Store option or legacy method', () => {
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
    dispose();

    expect(store.getSelectorTraceReporter()).toBeUndefined();
    expect('getSelectorExecutionTraceReporter' in store).toBe(false);
    expect('getSelectorComputationTraceOptions' in store).toBe(false);
    expect('getSelectorCacheTraceReporter' in store).toBe(false);
    expect(store.shouldTraceSelectorCache()).toBe(false);
    expect(store.getSelectorTraceSummary()).toEqual([]);
    expect((store as any).selectorTraceSummaryCollector).toBeUndefined();
    expect((store as any).selectorTraceSummaryInterval).toBeUndefined();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(consoleInfo).not.toHaveBeenCalled();
  });
});