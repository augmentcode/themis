import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as selectorCore from './utils/selector-core/create-cached-selector';
import { getStoreContext } from './utils/runtime-svelte/utils';

const { renderAccessedPathsSpy } = vi.hoisted(() => ({
  renderAccessedPathsSpy: vi.fn(),
}));

vi.mock('./utils/selector-core/create-cached-selector', async (importOriginal) => {
  const actual = await importOriginal<typeof selectorCore>();
  renderAccessedPathsSpy.mockImplementation(actual.renderAccessedPaths);

  return {
    ...actual,
    renderAccessedPaths: renderAccessedPathsSpy,
  };
});

vi.mock('./utils/runtime-svelte/utils', () => ({
  getStoreContext: vi.fn(() => undefined),
  getDispatch: vi.fn(),
}));

import { Store } from './svelte-store';
import { createCachedSelector } from './utils/selector-core/create-cached-selector';

const initialState = {
  count: 0,
  label: 'zero',
  user: { name: 'Ada' },
};
const reducer = Object.assign((state = initialState) => state, { initialState });

describe('Store selector trace rendering', () => {
  beforeEach(() => {
    renderAccessedPathsSpy.mockClear();
    vi.mocked(getStoreContext).mockReturnValue(undefined);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes raw accessed paths to trace reporters before any rendering', () => {
    const traceReporter = vi.fn();
    const selector = createCachedSelector<{ trace: { count: number } }, [], number>(
      (state) => state.trace.count,
      { traceReporter }
    );

    selector({ trace: { count: 1 } });

    expect(traceReporter).toHaveBeenCalledTimes(1);
    const trace = traceReporter.mock.calls[0][0];
    expect(trace.accessedPaths).toBeInstanceOf(Set);
    expect(trace.parsedPaths).toBeInstanceOf(Map);
    expect(Array.isArray(trace.accessedPaths)).toBe(false);
    expect(Array.from(trace.accessedPaths)).toEqual(['["trace"]', '["trace","count"]']);
  });

  it('activates legacy tracing from default and explicit false options before init', () => {
    const store = new Store({ trace: reducer });
    const explicitlyDisabledStore = new Store(
      { trace: reducer },
      undefined,
      { traceSelectors: false }
    );
    const selectCount = store.createSelector((state) => state.trace.count);
    const selectExplicitCount = explicitlyDisabledStore.createSelector((state) => state.trace.count);

    store.traceSelectors();
    explicitlyDisabledStore.traceSelectors();
    store.init();
    explicitlyDisabledStore.init();
    selectCount().subscribe(() => {})();
    selectExplicitCount().subscribe(() => {})();

    expect(store.getSelectorTraceReporter()).toEqual(expect.any(Function));
    expect(explicitlyDisabledStore.getSelectorTraceReporter()).toEqual(expect.any(Function));
    expect(renderAccessedPathsSpy).toHaveBeenCalledTimes(2);
    expect(console.info).toHaveBeenCalledWith(
      '[themis] selector trace',
      expect.objectContaining({ accessedPaths: ['trace', 'trace.count'] })
    );
  });

  it('renders accessed paths for every enabled selector execution', () => {
    const store = new Store(
      { trace: reducer },
      undefined,
      { traceSelectors: true }
    );
    const selectCount = store.createSelector((state) => state.trace.count);
    const selectLabel = store.createSelector((state) => state.trace.label);
    const selectTrace = store.createSelector((state) => state.trace);
    const selectUserName = store.createSelector((state) => state.trace.user.name);

    store.init();

    const accessedPathTraces = () =>
      vi.mocked(console.info).mock.calls.filter(([, payload]) => {
        return payload && typeof payload === 'object' && 'accessedPathCount' in payload;
      });

    selectCount().subscribe(() => {})();
    expect(renderAccessedPathsSpy).toHaveBeenCalledTimes(1);
    expect(accessedPathTraces()).toHaveLength(1);

    selectLabel().subscribe(() => {})();
    selectTrace().subscribe(() => {})();
    expect(renderAccessedPathsSpy).toHaveBeenCalledTimes(3);
    expect(accessedPathTraces()).toHaveLength(3);

    selectUserName().subscribe(() => {})();
    expect(renderAccessedPathsSpy).toHaveBeenCalledTimes(4);
    expect(accessedPathTraces()).toHaveLength(4);
  });

  it('keeps configured flat categories unchanged when the legacy method is called', () => {
    const store = new Store(
      { trace: reducer },
      undefined,
      { traceSelectors: { traceInvalidation: true } }
    );
    const selectCount = store.createSelector((state) => state.trace.count);

    store.traceSelectors();
    store.init();
    selectCount().subscribe(() => {})();

    const payloads = vi.mocked(console.info).mock.calls.map(([, payload]) => payload);
    expect(payloads).toEqual([
      expect.objectContaining({ invalidationReason: 'first-execution' }),
    ]);
    expect(payloads[0]).not.toHaveProperty('accessedPaths');
    expect(renderAccessedPathsSpy).not.toHaveBeenCalled();
  });

  it('reports execution timing and recomputation count only when the selector executes', () => {
    const traceReporter = vi.fn();
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(12.5)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(24);
    const selector = createCachedSelector<{ count: number }, [], number>(
      (state) => state.count,
      { traceReporter }
    );

    selector({ count: 1 });
    selector({ count: 1 });
    selector({ count: 2 });

    expect(now).toHaveBeenCalledTimes(4);
    expect(traceReporter.mock.calls.map(([trace]) => trace)).toEqual([
      expect.objectContaining({ executionDurationMs: 2.5, recomputationCount: 1 }),
      expect.objectContaining({ executionDurationMs: 4, recomputationCount: 2 }),
    ]);
  });
});