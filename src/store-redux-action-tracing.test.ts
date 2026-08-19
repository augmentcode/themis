import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingStore } from './streaming-store';
import type { ReduxActionTraceEvent, StoreLoggerFactory } from './types';

const counterReducer = Object.assign(
  (state = { count: 0, items: ['before'] }, action: any) => {
    if (action.type === 'counter/set') {
      return { ...state, count: action.payload };
    }
    if (action.type === 'items/set') {
      return { ...state, items: action.payload };
    }
    return state;
  },
  { initialState: { count: 0, items: ['before'] } }
);

describe('Store Redux action tracing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the one-time legend, action styles, records, and lazy path diff', () => {
    const store = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { logReduxActions: true }
    );
    store.init();

    expect(
      vi.mocked(console.log).mock.calls.some(
        ([message]) => typeof message === 'string' && message.includes('Redux Logger Active')
      )
    ).toBe(true);
    vi.mocked(console.log).mockClear();
    vi.mocked(console.groupCollapsed).mockClear();
    vi.mocked(console.groupEnd).mockClear();

    store.dispatch({ type: 'items/set', payload: ['after'] });
    store.dispatch({ type: 'counter/set', payload: 1 });
    store.dispatch({ type: 'noop', payload: { nested: true } });

    expect(console.groupCollapsed).toHaveBeenNthCalledWith(
      1,
      '%citems/set after',
      'color: inherit; font-weight: 600'
    );
    expect(console.groupCollapsed).toHaveBeenNthCalledWith(
      2,
      '%ccounter/set 1',
      'color: inherit; font-weight: 600'
    );
    expect(console.groupCollapsed).toHaveBeenNthCalledWith(
      3,
      '%cnoop',
      'color: #9E9E9E; font-weight: 300'
    );
    expect(console.log).toHaveBeenCalledWith(
      '%c action    ',
      'color: #03A9F4; font-weight: bold',
      { type: 'items/set', payload: ['after'] }
    );
    const changedPayload = vi.mocked(console.log).mock.calls.find(
      ([label]) => label === '%c state    '
    )?.[2] as { changes: unknown };
    expect(changedPayload.changes).toEqual({
      'counter.items[0]': { prev: 'before', next: 'after' },
    });
    expect(console.log).toHaveBeenCalledWith(
      '%c state (no changes)',
      'color: #9E9E9E; font-weight: lighter',
      { state: store.state }
    );
    expect(console.groupEnd).toHaveBeenCalledTimes(3);

    vi.mocked(console.log).mockClear();
    const secondStore = new StreamingStore(undefined, undefined, { logReduxActions: true });
    secondStore.init();
    expect(
      vi.mocked(console.log).mock.calls.some(
        ([message]) => typeof message === 'string' && message.includes('Redux Logger Active')
      )
    ).toBe(false);
    secondStore.dispose();
    store.dispose();
  });

  it('uses only a custom logger and reattaches it after dispose', () => {
    const events: ReduxActionTraceEvent[] = [];
    const disposers: Array<ReturnType<typeof vi.fn>> = [];
    const loggerFactory: StoreLoggerFactory = (streams) => {
      const subscription = streams.reduxAction.observe((event) => events.push(event));
      const disposer = vi.fn(() => subscription.unsubscribe());
      disposers.push(disposer);
      return disposer;
    };
    const store = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { logReduxActions: true, loggerFactory }
    );

    store.init();
    store.dispatch({ type: 'counter/set', payload: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({ stateChanged: true }));
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.groupCollapsed).not.toHaveBeenCalled();

    store.dispose();
    expect(disposers[0]).toHaveBeenCalledOnce();
    store.init();
    store.dispatch({ type: 'counter/set', payload: 2 });
    expect(events).toHaveLength(2);
    store.dispose();
    expect(disposers[1]).toHaveBeenCalledOnce();
  });

  it('emits no Redux action events when the option is disabled', () => {
    const events: ReduxActionTraceEvent[] = [];
    const store = new StreamingStore(
      { counter: counterReducer },
      undefined,
      {
        loggerFactory: (streams) => {
          const subscription = streams.reduxAction.observe((event) => events.push(event));
          return () => subscription.unsubscribe();
        },
      }
    );

    store.init();
    store.dispatch({ type: 'counter/set', payload: 1 });
    expect(events).toEqual([]);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.groupCollapsed).not.toHaveBeenCalled();
    store.dispose();
  });
});