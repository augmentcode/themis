import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@augmentcode/themis/react-store';
import { Store } from '@augmentcode/themis/svelte-store';
import { StreamingStore } from '@augmentcode/themis/streaming-store';
import type {
  ReduxActionTraceEvent as ReactReduxActionTraceEvent,
  StoreLoggerFactory as ReactStoreLoggerFactory,
  StoreTraceStreams as ReactStoreTraceStreams,
} from '@augmentcode/themis/react-store';
import type {
  ReduxActionTraceEvent as SvelteReduxActionTraceEvent,
  StoreLoggerFactory as SvelteStoreLoggerFactory,
  StoreTraceStreams as SvelteStoreTraceStreams,
} from '@augmentcode/themis/svelte-store';
import type {
  ReduxActionTraceEvent as StreamingReduxActionTraceEvent,
  StoreLoggerFactory as StreamingStoreLoggerFactory,
  StoreTraceStreams as StreamingStoreTraceStreams,
} from '@augmentcode/themis/streaming-store';
import type {
  ReduxActionTraceEvent,
  StoreLoggerFactory,
  StoreTraceStreams,
} from '@augmentcode/themis/types';

vi.mock('./utils/runtime-svelte/utils', () => ({
  getStoreContext: vi.fn(() => undefined),
  getDispatch: vi.fn(),
}));

const counterReducer = Object.assign(
  (state = { count: 0 }) => state,
  { initialState: { count: 0 } }
);

describe('Store tracing stream contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exports logging types from every Store-family entrypoint', () => {
    const streams: StoreTraceStreams = {} as StoreTraceStreams;
    const loggerFactory: StoreLoggerFactory = () => undefined;
    const reduxEvent: ReduxActionTraceEvent = {
      action: { type: 'test' },
      prevState: {},
      nextState: {},
      stateChanged: true,
    };
    const familyStreams: [
      SvelteStoreTraceStreams,
      ReactStoreTraceStreams,
      StreamingStoreTraceStreams,
    ] = [streams, streams, streams];
    const familyFactories: [
      SvelteStoreLoggerFactory,
      ReactStoreLoggerFactory,
      StreamingStoreLoggerFactory,
    ] = [loggerFactory, loggerFactory, loggerFactory];
    const familyEvents: [
      SvelteReduxActionTraceEvent,
      ReactReduxActionTraceEvent,
      StreamingReduxActionTraceEvent,
    ] = [reduxEvent, reduxEvent, reduxEvent];

    expect(familyStreams).toHaveLength(3);
    expect(familyFactories).toHaveLength(3);
    expect(familyEvents).toHaveLength(3);
  });

  it('exposes equivalent read-only streams on every Store family', () => {
    for (const store of [
      new Store(),
      new ReactStore(),
      new StreamingStore(),
    ]) {
      const publicStreams: StoreTraceStreams = store.traceStreams;
      expect(Object.keys(store.traceStreams)).toEqual([
        'selectorDetail',
        'selectorSummary',
        'selectorCadence',
        'sagaMonitor',
        'runtimeError',
        'reduxAction',
      ]);
      expect(Object.isFrozen(store.traceStreams)).toBe(true);
      expect((store.traceStreams.selectorDetail as any).plug).toBeUndefined();
      expect((store.traceStreams.reduxAction as any).plug).toBeUndefined();
      expect(publicStreams).toBe(store.traceStreams);
    }
  });

  it('publishes Redux action events through every Store family', () => {
    const familyEvents: unknown[][] = [[], [], []];
    const stores = [Store, ReactStore, StreamingStore].map((StoreFamily, index) =>
      new StoreFamily(
        { counter: counterReducer },
        undefined,
        {
          logReduxActions: true,
          loggerFactory: (streams) => {
            const subscription = streams.reduxAction.observe((event) => {
              familyEvents[index].push(event);
            });
            return () => subscription.unsubscribe();
          },
        }
      )
    );

    for (const [index, store] of stores.entries()) {
      store.init();
      familyEvents[index] = [];
      store.dispatch({ type: `family/${index}` });
      expect(familyEvents[index]).toHaveLength(1);
      expect(familyEvents[index][0]).toEqual(
        expect.objectContaining({ action: { type: `family/${index}` } })
      );
      expect(Object.isFrozen(familyEvents[index][0])).toBe(true);
      store.dispose();
    }
  });

  it('normalizes and validates the optional logger factory', () => {
    const loggerFactory: StoreLoggerFactory = () => undefined;
    const store = new Store(undefined, undefined, { loggerFactory });

    expect((store as any).storeOptions.loggerFactory).toBe(loggerFactory);
    expect(() =>
      new Store(undefined, undefined, { loggerFactory: 'invalid' as any })
    ).toThrow('Store option "loggerFactory" must be a function.');
  });

  it('selects the default logger when no factory is supplied', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const store = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { traceSelectors: { traceExecution: true } }
    );
    const selectCount = store.createSelector((state) => state.counter.count);
    store.init();
    selectCount().observe(() => undefined).unsubscribe();
    expect(consoleInfo).toHaveBeenCalledWith(
      '[themis] selector trace',
      expect.objectContaining({ selectorSource: expect.any(String) })
    );
    store.dispose();
  });

  it('attaches only a custom logger and reattaches it after disposal', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const events: unknown[] = [];
    const disposers: Array<() => void> = [];
    const loggerFactory: StoreLoggerFactory = (streams) => {
      events.push(streams);
      const subscription = streams.selectorDetail.observe((event) => events.push(event));
      const disposer = vi.fn(() => subscription.unsubscribe());
      disposers.push(disposer);
      return disposer;
    };
    const store = new StreamingStore(
      { counter: counterReducer },
      undefined,
      { traceSelectors: { traceExecution: true }, loggerFactory }
    );
    const selectCount = store.createSelector((state) => state.counter.count);
    store.init();
    selectCount().observe(() => undefined).unsubscribe();
    expect(events[0]).toBe(store.traceStreams);
    expect(events.some((event) => (event as any)?.kind === 'selector')).toBe(true);
    expect(consoleInfo).not.toHaveBeenCalled();

    store.dispose();
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    store.init();
    expect(events[2]).toBe(store.traceStreams);
    store.dispose();
    expect(disposers[1]).toHaveBeenCalledTimes(1);
  });

  it('routes runtime diagnostics to a custom logger without default console output', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: unknown[] = [];
    const store = new StreamingStore(undefined, undefined, {
      loggerFactory: (streams) => {
        const subscription = streams.runtimeError.observe((event) => events.push(event));
        return () => subscription.unsubscribe();
      },
    });
    const error = new Error('runtime boom');

    store.init();
    store.reportRuntimeError(error, 'test', 'Runtime diagnostic');

    expect(events).toEqual([
      { error, source: 'test', message: 'Runtime diagnostic' },
    ]);
    expect(consoleError).not.toHaveBeenCalled();
    store.dispose();
  });

  it('preserves duplicate-store payloads through the devtools runtime stream', () => {
    vi.stubGlobal('window', {});
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: unknown[] = [];
    const firstStore = new StreamingStore();
    const secondStore = new StreamingStore(undefined, undefined, {
      loggerFactory: (streams) => {
        const subscription = streams.runtimeError.observe((event) => events.push(event));
        return () => subscription.unsubscribe();
      },
    });

    firstStore.init();
    secondStore.init();
    const disposeFirstDevTools = firstStore.initDevTool();
    const disposeSecondDevTools = secondStore.initDevTool();

    expect(events).toContainEqual({
      error: expect.any(Error),
      source: 'global-dev-tools',
      message: 'Multiple Redux stores initialized:',
      payload: [firstStore, secondStore],
    });

    disposeSecondDevTools();
    disposeFirstDevTools();
    secondStore.dispose();
    firstStore.dispose();
  });
});