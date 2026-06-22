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

  it('does not render accessed paths when tracing is disabled', () => {
    const store = new Store({ trace: reducer });
    const selectCount = store.createSelector((state) => state.trace.count);

    store.init();
    selectCount().subscribe(() => {})();

    expect(renderAccessedPathsSpy).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it('renders accessed paths only after enabled tracing reaches a new maximum', () => {
    const store = new Store({ trace: reducer });
    const selectCount = store.createSelector((state) => state.trace.count);
    const selectLabel = store.createSelector((state) => state.trace.label);
    const selectTrace = store.createSelector((state) => state.trace);
    const selectUserName = store.createSelector((state) => state.trace.user.name);

    store.traceSelectors();
    store.init();

    selectCount().subscribe(() => {})();
    expect(renderAccessedPathsSpy).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);

    selectLabel().subscribe(() => {})();
    selectTrace().subscribe(() => {})();
    expect(renderAccessedPathsSpy).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);

    selectUserName().subscribe(() => {})();
    expect(renderAccessedPathsSpy).toHaveBeenCalledTimes(2);
    expect(console.info).toHaveBeenCalledTimes(2);
  });
});