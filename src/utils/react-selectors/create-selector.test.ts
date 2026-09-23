import { signal, type ReadonlySignal } from "@preact/signals-react";
import type { Observable } from "kefir";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { StoreState } from "../../types";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";
import { ReactStore } from "../../react-store";

const mocks = vi.hoisted(() => ({
  select: vi.fn((selector: unknown, ...args: unknown[]) => ({ kind: "select", selector, args })),
  useSignals: vi.fn(),
}));

vi.mock("typed-redux-saga", () => ({
  select: mocks.select,
}));

vi.mock("@preact/signals-react/runtime", () => ({
  useSignals: mocks.useSignals,
}));

import { createSelector } from "./create-selector";
import { createKefirPropertyFromSubscribe } from "../selector-core/kefir-selector";

type CounterState = StoreState & {
  counter: { count: number };
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: boolean };
};

type InternalUtilityTestState = {
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: boolean };
};

const withUtility = <T extends StoreState>(state: T): T & InternalUtilityTestState => ({
  ...state,
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false },
});

class MockSignalRuntimeStore<TState extends StoreState> extends ReactStore<any, any> {
  readonly getStoreStateStreamMock = vi.fn();
  readonly getStoreStateSnapshotMock = vi.fn();

  constructor(
    private readonly readState: () => TState,
    private readonly stateStream: Observable<TState, any>,
    private readonly streamError?: Error
  ) {
    super();
  }

  override get state(): TState {
    return this.readState();
  }

  override getStoreStateStream(): Observable<TState, any> {
    this.getStoreStateStreamMock();
    if (this.streamError) {
      throw this.streamError;
    }
    return this.stateStream;
  }

  override getStoreStateSnapshot(): TState {
    this.getStoreStateSnapshotMock();
    return this.readState();
  }
}

const createMockStoreBinding = <TState extends StoreState>(
  signalState: ReadonlySignal<TState>
): MockSignalRuntimeStore<TState> => {
  const stateStream = createKefirPropertyFromSubscribe(
    () => signalState.value,
    (listener) => signalState.subscribe(listener)
  );

  return new MockSignalRuntimeStore(() => signalState.value, stateStream);
};

const assertPlainSignalStateSourceRejected = () => {
  const state = withUtility({ counter: { count: 1 } });
  const plainStoreLike = {
    state,
    getStoreStateStream: () => createKefirPropertyFromSubscribe(() => state, () => () => {}),
    getStoreStateSnapshot: () => state,
  };

  // @ts-expect-error Plain structural state sources are not ReactStore instances.
  createSelector(plainStoreLike, (state) => state.counter.count);
};
void assertPlainSignalStateSourceRejected;

describe("react createSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("exposes .select() as the plain selector callback", () => {
    const selectorFn = vi.fn((state: StoreState, salutation: string) => {
      return `${salutation}, ${state.user.name}`;
    });
    const state = withUtility({ user: { name: "Ada" } });
    const selectorStore = createMockStoreBinding(signal(state));
    const selectGreeting = createSelector(selectorStore, selectorFn);

    expect(selectGreeting.select).toBe(selectorFn);
    expect(selectGreeting.select(state, "Hello")).toBe("Hello, Ada");
    expect(selectorFn).toHaveBeenCalledWith(state, "Hello");
  });

  it("delegates .effect() to typed-redux-saga select", () => {
    const selectorFn = (state: StoreState, id: string) => state.users[id];
    const selectorStore = createMockStoreBinding(signal(withUtility({ users: { u1: "Ada" } })));
    const selectUser = createSelector(selectorStore, selectorFn);

    expect(selectUser.effect("u1")).toEqual({ kind: "select", selector: selectorFn, args: ["u1"] });
    expect(mocks.select).toHaveBeenCalledWith(selectorFn, "u1");
  });

  it("returns a signal from direct selector invocation and emits selected values", () => {
    const state = signal<CounterState>(withUtility({ counter: { count: 2 } }));
    const multiplier = signal(3);
    const selectorStore = createMockStoreBinding(state);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });
    const values: number[] = [];

    const selected = selectScaledCount(multiplier);
    expectTypeOf(selected).toEqualTypeOf<ReadonlySignal<number>>();
    const unsubscribe = selected.subscribe((value) => values.push(value));
    multiplier.value = 4;
    state.value = withUtility({ counter: { count: 5 } });
    expect(values).toEqual([6, 8, 20]);
    vi.advanceTimersByTime(0);
    unsubscribe();

    expect(values).toEqual([6, 8, 20]);
  });

  it("emits signal argument changes immediately when the selector result changes", () => {
    const state = signal<CounterState>(withUtility({ counter: { count: 2 } }));
    const multiplier = signal(3);
    const selectorStore = createMockStoreBinding(state);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });
    const values: number[] = [];

    const unsubscribe = selectScaledCount(multiplier).subscribe((value) => values.push(value));
    multiplier.value = 4;
    multiplier.value = 5;
    expect(values).toEqual([6, 8, 10]);

    vi.advanceTimersByTime(0);
    unsubscribe();

    expect(values).toEqual([6, 8, 10]);
  });

  it("reads selector cache locks from the internal store utility domain", () => {
    const state = signal<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(state);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const values: number[] = [];

    const unsubscribe = selectCount().subscribe((value) => values.push(value));
    state.value = { counter: { count: 5 }, [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: true } };
    state.value = { counter: { count: 7 }, [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false } };
    vi.advanceTimersByTime(0);
    unsubscribe();

    expect(values).toEqual([2, 7]);
  });

  it("creates signal selectors bound to an explicit signal state source with .withStore()", () => {
    const defaultState = signal<CounterState>(withUtility({ counter: { count: 1 } }));
    const overrideState = signal<CounterState>(withUtility({ counter: { count: 5 } }));
    const selectorStore = createMockStoreBinding(defaultState);
    const overrideStore = createMockStoreBinding(overrideState);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const values: number[] = [];

    const boundSelector = selectCount.withStore(overrideStore);
    expectTypeOf(boundSelector()).toEqualTypeOf<ReadonlySignal<number>>();
    const unsubscribe = boundSelector().subscribe((value) => values.push(value));
    defaultState.value = withUtility({ counter: { count: 3 } });
    overrideState.value = withUtility({ counter: { count: 6 } });
    vi.advanceTimersByTime(0);
    unsubscribe();

    expect(overrideStore.getStoreStateStreamMock).toHaveBeenCalledTimes(1);
    expect(values).toEqual([5, 6]);
  });

  it("exposes .useValue() as a React signal hook read of the selector value", () => {
    const state = signal<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(state);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);

    expect(selectCount.useValue()).toBe(2);
    expect(mocks.useSignals).toHaveBeenCalledTimes(1);
  });

  it("reuses cached selector signal outputs for the same state source and args", () => {
    const state = signal<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(state);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });

    expect(selectScaledCount(3)).toBe(selectScaledCount(3));
  });

  it("creates distinct selector signal outputs for different primitive args", () => {
    const state = signal<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(state);
    const selectLabel = createSelector(selectorStore, (state, label: string, page: number) => {
      return `${label}:${page}:${state.counter.count}`;
    });

    expect(selectLabel("count", 1)).toBe(selectLabel("count", 1));
    expect(selectLabel("count", 1)).not.toBe(selectLabel("count", 2));
    expect(selectLabel("count", 1)).not.toBe(selectLabel("other", 1));
  });

  it("keys selector signal outputs by object identity and argument ordering", () => {
    const state = signal<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(state);
    const selectPair = createSelector(selectorStore, (state, first: { id: string }, second: { id: string }) => {
      return `${first.id}:${second.id}:${state.counter.count}`;
    });
    const first = { id: "first" };
    const firstCopy = { id: "first" };
    const second = { id: "second" };

    expect(selectPair(first, second)).toBe(selectPair(first, second));
    expect(selectPair(first, second)).not.toBe(selectPair(firstCopy, second));
    expect(selectPair(first, second)).not.toBe(selectPair(second, first));
  });

  it("separates cached selector signal outputs by explicit state source", () => {
    const defaultState = signal<CounterState>(withUtility({ counter: { count: 1 } }));
    const sharedOverrideState = signal<CounterState>(withUtility({ counter: { count: 5 } }));
    const selectorStore = createMockStoreBinding(defaultState);
    const overrideStoreA = createMockStoreBinding(sharedOverrideState);
    const overrideStoreB = createMockStoreBinding(sharedOverrideState);
    const selectCount = createSelector(selectorStore, (state, label: string) => {
      return `${label}:${state.counter.count}`;
    });

    expect(selectCount.withStore(overrideStoreA)("count")).toBe(selectCount.withStore(overrideStoreA)("count"));
    expect(selectCount.withStore(overrideStoreA)("count")).not.toBe(selectCount.withStore(overrideStoreB)("count"));
  });

  it("propagates StoreRuntime state stream initialization guard errors", () => {
    const state = withUtility({ counter: { count: 0 } });
    const selectorStore = new MockSignalRuntimeStore(
      () => state,
      createKefirPropertyFromSubscribe(() => state, () => () => {}),
      new Error("Cannot access StoreRuntime.getStoreStateStream() before Store.init() has been called.")
    );
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);

    expect(() => selectCount()).toThrow(
      "Cannot access StoreRuntime.getStoreStateStream() before Store.init() has been called."
    );
  });

  it("rejects the old standalone selector function shape at runtime", () => {
    const selectorFn = (state: CounterState) => state.counter.count;

    expect(() => (createSelector as unknown as (selectorFunc: unknown) => unknown)(selectorFn)).toThrow(
      "createSelector requires a Store-like state source as the first argument."
    );
  });

  it("evicts a signal only after its final watcher leaves", () => {
    const state = signal<CounterState>(withUtility({ counter: { count: 1 } }));
    const selectorStore = createMockStoreBinding(state);
    const selectScaled = createSelector(selectorStore, (value, factor: number) => value.counter.count * factor);
    const first = selectScaled(2);
    const concurrent = selectScaled(3);
    const firstSubscriptionA = first.subscribe(() => {});
    const firstSubscriptionB = first.subscribe(() => {});
    const concurrentSubscription = concurrent.subscribe(() => {});

    expect(selectScaled(2)).toBe(first);
    firstSubscriptionA();
    expect(selectScaled(2)).toBe(first);
    concurrentSubscription();
    firstSubscriptionB();

    state.value = withUtility({ counter: { count: 5 } });
    const fresh = selectScaled(2);
    expect(fresh).not.toBe(first);
    expect(fresh.value).toBe(10);
    expect(selectScaled(3)).not.toBe(concurrent);
  });

  describe("watcher lifecycle contract", () => {
    const cleanups: Array<() => void> = [];
    const watch = (output: ReadonlySignal<number>, values: number[] = []) => {
      const stop = output.subscribe((value) => values.push(value));
      cleanups.push(stop);
      return stop;
    };
    const fixture = (hooks: { watched?: () => void; unwatched?: () => void } = {}) => {
      const state = signal<CounterState>(withUtility({ counter: { count: 1 } }));
      const watched = vi.fn(hooks.watched);
      const unwatched = vi.fn(hooks.unwatched);
      const factor = signal(2, { watched, unwatched });
      const subscribe = factor.subscribe.bind(factor);
      const stopped = vi.fn();
      // Count real subscriptions, not just shared-source activation transitions.
      const started = vi.spyOn(factor, "subscribe").mockImplementation((listener) => {
        const stop = subscribe(listener);
        return () => {
          stopped();
          stop();
        };
      });
      const store = createMockStoreBinding(state);
      const select = createSelector(store, (value, multiplier: number) => value.counter.count * multiplier);
      return { state, factor, get: () => select(factor), started, stopped, watched, unwatched };
    };

    afterEach(() => {
      cleanups.splice(0).reverse().forEach((stop) => stop());
      vi.restoreAllMocks();
    });

    it("starts once for the first watcher and stops only after the final watcher", () => {
      const c = fixture();
      const output = c.get();
      expect(c.started).not.toHaveBeenCalled();
      const first: number[] = [], second: number[] = [];
      const stopFirst = watch(output, first);
      const stopSecond = watch(output, second);
      expect(c.started).toHaveBeenCalledTimes(1);
      expect(c.watched).toHaveBeenCalledTimes(1);
      expect(c.get()).toBe(output);

      stopFirst();
      expect(c.stopped).not.toHaveBeenCalled();
      expect(c.unwatched).not.toHaveBeenCalled();
      expect(c.get()).toBe(output);
      c.factor.value = 3;
      expect(first).toEqual([2]);
      expect(second).toEqual([2, 3]);

      stopSecond();
      expect(c.stopped).toHaveBeenCalledTimes(1);
      expect(c.unwatched).toHaveBeenCalledTimes(1);
      expect(c.get()).not.toBe(output);
      stopSecond();
      expect(c.stopped).toHaveBeenCalledTimes(1);
    });

    it("repeatedly reactivates an old output with the latest snapshot and no duplicate subscription", () => {
      const c = fixture();
      const old = c.get();
      watch(old)();
      const replacement = c.get();
      expect(replacement).not.toBe(old);

      for (let cycle = 1; cycle <= 3; cycle += 1) {
        c.state.value = withUtility({ counter: { count: cycle + 1 } });
        c.factor.value = cycle + 2;
        const values: number[] = [];
        const stop = watch(old, values);
        const stopAdditional = watch(old);
        expect(values).toEqual([(cycle + 1) * (cycle + 2)]);
        expect(c.started).toHaveBeenCalledTimes(cycle + 1);
        expect(c.stopped).toHaveBeenCalledTimes(cycle);
        stop();
        expect(c.stopped).toHaveBeenCalledTimes(cycle);
        stopAdditional();
        expect(c.stopped).toHaveBeenCalledTimes(cycle + 1);
        expect(c.watched).toHaveBeenCalledTimes(cycle + 1);
        expect(c.unwatched).toHaveBeenCalledTimes(cycle + 1);
        expect(c.get()).toBe(replacement);
      }
    });

    it("keeps a distinct active replacement subscribed through stale old-output cleanup", () => {
      const c = fixture();
      const old = c.get();
      watch(old)();
      const replacement = c.get();
      const values: number[] = [];
      const stopReplacement = watch(replacement, values);
      const stopOld = watch(old);
      expect(c.started).toHaveBeenCalledTimes(3);
      expect(c.stopped).toHaveBeenCalledTimes(1);

      stopOld();
      expect(c.stopped).toHaveBeenCalledTimes(2);
      expect(c.unwatched).toHaveBeenCalledTimes(1);
      expect(c.get()).toBe(replacement);
      c.factor.value = 5;
      expect(values).toEqual([2, 5]);
      stopReplacement();
      expect(c.stopped).toHaveBeenCalledTimes(3);
      expect(c.unwatched).toHaveBeenCalledTimes(2);
    });

    it("allows a synchronous upstream activation callback to add and remove another watcher", () => {
      const nested: number[] = [];
      let output: ReadonlySignal<number>;
      const c = fixture({ watched: () => {
        expect(c.get()).toBe(output);
        watch(output, nested)();
      } });
      output = c.get();
      const values: number[] = [];
      const stop = watch(output, values);
      expect(nested).toEqual([2]);
      expect(values).toEqual([2]);
      expect(c.started).toHaveBeenCalledTimes(1);
      expect(c.stopped).not.toHaveBeenCalled();
      expect(c.watched).toHaveBeenCalledTimes(1);
      expect(c.get()).toBe(output);
      c.factor.value = 4;
      expect(values).toEqual([2, 4]);
      expect(nested).toEqual([2]);
      stop();
      expect(c.stopped).toHaveBeenCalledTimes(1);
      expect(c.unwatched).toHaveBeenCalledTimes(1);
    });

    it("refreshes the inactive snapshot after synchronous upstream teardown changes", () => {
      const c = fixture({ unwatched: () => {
        c.state.value = withUtility({ counter: { count: 3 } });
        c.factor.value = 4;
      } });
      const output = c.get();
      const values: number[] = [];
      watch(output, values)();
      expect(values).toEqual([2]);
      expect(output.value).toBe(12);
      expect(c.started).toHaveBeenCalledTimes(1);
      expect(c.stopped).toHaveBeenCalledTimes(1);
      expect(c.get()).not.toBe(output);
      const resumed: number[] = [];
      watch(output, resumed)();
      expect(resumed).toEqual([12]);
      expect(c.started).toHaveBeenCalledTimes(2);
      expect(c.stopped).toHaveBeenCalledTimes(2);
    });

    it("preserves a watcher added synchronously by an upstream teardown callback", () => {
      let output: ReadonlySignal<number>;
      let stopReentrant: (() => void) | undefined;
      const resumed: number[] = [];
      const c = fixture({ unwatched: () => {
        if (!stopReentrant) stopReentrant = watch(output, resumed);
      } });
      output = c.get();
      watch(output)();
      expect(resumed).toEqual([2]);
      expect(c.started).toHaveBeenCalledTimes(2);
      expect(c.stopped).toHaveBeenCalledTimes(1);
      expect.soft(c.get()).toBe(output);
      c.factor.value = 3;
      expect.soft(resumed).toEqual([2, 3]);
      stopReentrant!();
      expect.soft(c.stopped).toHaveBeenCalledTimes(2);
      expect(c.get()).not.toBe(output);
    });

    it.each([false, true])("handles reactivation and immediate re-stop during teardown, renew=%s", (renew) => {
      let output: ReadonlySignal<number>;
      let stopRenewed: (() => void) | undefined;
      let reentered = false;
      const temporary: number[] = [], renewed: number[] = [];
      const c = fixture({ unwatched: () => {
        if (reentered) return;
        reentered = true;
        watch(output, temporary)();
        if (renew) stopRenewed = watch(output, renewed);
        c.factor.value = 4;
      } });
      output = c.get();
      watch(output)();
      expect(temporary).toEqual([2]);
      expect(output.value).toBe(4);
      // A watcher stopped inside teardown must not open an upstream subscription.
      expect(c.started).toHaveBeenCalledTimes(renew ? 2 : 1);
      expect(c.stopped).toHaveBeenCalledTimes(1);
      expect(c.watched).toHaveBeenCalledTimes(renew ? 2 : 1);
      expect(c.unwatched).toHaveBeenCalledTimes(1);

      if (renew) {
        expect(c.get()).toBe(output);
        expect(renewed).toEqual([2, 4]);
        c.factor.value = 5;
        expect(renewed).toEqual([2, 4, 5]);
        stopRenewed!();
        expect(c.stopped).toHaveBeenCalledTimes(2);
        expect(c.unwatched).toHaveBeenCalledTimes(2);
      }
      expect(c.get()).not.toBe(output);
      const latest: number[] = [];
      watch(output, latest)();
      expect(latest).toEqual([renew ? 5 : 4]);
      expect(c.started).toHaveBeenCalledTimes(renew ? 3 : 2);
      expect(c.stopped).toHaveBeenCalledTimes(renew ? 3 : 2);
    });

    it("owns each renewed subscription across repeated synchronous teardown reactivation", () => {
      let output: ReadonlySignal<number>;
      let stop: () => void;
      let renewals = 0;
      const resumed: number[][] = [];
      const c = fixture({ unwatched: () => {
        if (renewals === 3) return;
        renewals += 1;
        const values: number[] = [];
        resumed.push(values);
        stop = watch(output, values);
      } });
      output = c.get();
      stop = watch(output);

      for (let cycle = 1; cycle <= 3; cycle += 1) {
        stop();
        expect(c.started).toHaveBeenCalledTimes(cycle + 1);
        expect(c.stopped).toHaveBeenCalledTimes(cycle);
        expect(c.get()).toBe(output);
        c.factor.value = cycle + 2;
        expect(resumed[cycle - 1]).toEqual([cycle + 1, cycle + 2]);
      }
      stop();
      expect(c.started).toHaveBeenCalledTimes(4);
      expect(c.stopped).toHaveBeenCalledTimes(4);
      expect(c.watched).toHaveBeenCalledTimes(4);
      expect(c.unwatched).toHaveBeenCalledTimes(4);
      expect(c.get()).not.toBe(output);
    });

    it.each([false, true])("cleans up a renewed watcher stopped during upstream activation, replace=%s", (replace) => {
      let output: ReadonlySignal<number>;
      let stopRenewed: (() => void) | undefined;
      let stopReplacement: (() => void) | undefined;
      let stoppedDuringActivation = false;
      let renewed = false;
      const values: number[] = [], replacement: number[] = [];
      const c = fixture({
        watched: () => {
          if (!stopRenewed || stoppedDuringActivation) return;
          stoppedDuringActivation = true;
          stopRenewed();
          if (replace) stopReplacement = watch(output, replacement);
        },
        unwatched: () => {
          if (renewed) return;
          renewed = true;
          stopRenewed = watch(output, values);
        },
      });
      output = c.get();
      watch(output)();
      expect(values).toEqual([2]);
      expect(c.started).toHaveBeenCalledTimes(replace ? 3 : 2);
      expect(c.stopped).toHaveBeenCalledTimes(2);
      expect(c.watched).toHaveBeenCalledTimes(replace ? 3 : 2);
      expect(c.unwatched).toHaveBeenCalledTimes(2);
      if (replace) expect(c.get()).toBe(output);
      c.factor.value = 3;
      expect(values).toEqual([2]);
      if (replace) {
        expect(replacement).toEqual([2, 3]);
        stopReplacement!();
      }
      expect(c.stopped).toHaveBeenCalledTimes(replace ? 3 : 2);
      expect(c.unwatched).toHaveBeenCalledTimes(replace ? 3 : 2);
      expect(c.get()).not.toBe(output);
    });

    it("preserves a renewed watcher when upstream teardown throws", () => {
      let output: ReadonlySignal<number>;
      let stopRenewed: (() => void) | undefined;
      let renewed = false;
      const values: number[] = [];
      const failure = new Error("upstream teardown failure");
      const c = fixture({ unwatched: () => {
        if (renewed) return;
        renewed = true;
        stopRenewed = watch(output, values);
        throw failure;
      } });
      output = c.get();
      const stopFirst = watch(output);
      let caught: unknown;
      try {
        stopFirst();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      c.factor.value = 3;
      expect.soft(values).toEqual([2, 3]);
      expect.soft(output.value).toBe(3);
      expect.soft(c.started).toHaveBeenCalledTimes(2);
      expect(c.stopped).toHaveBeenCalledTimes(1);
      expect(c.get()).toBe(output);
      stopRenewed!();
      expect.soft(c.stopped).toHaveBeenCalledTimes(2);
      expect(c.get()).not.toBe(output);
    });

    it("does not refresh or evict after upstream teardown throws without renewal", () => {
      let failed = false;
      const failure = new Error("upstream teardown failure");
      const c = fixture({ unwatched: () => {
        if (failed) return;
        failed = true;
        c.state.value = withUtility({ counter: { count: 3 } });
        c.factor.value = 4;
        throw failure;
      } });
      const output = c.get();
      const stop = watch(output);
      let caught: unknown;
      try {
        stop();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      expect(output.value).toBe(2);
      expect(c.get()).toBe(output);
      expect(c.started).toHaveBeenCalledTimes(1);
      expect(c.stopped).toHaveBeenCalledTimes(1);
      const values: number[] = [];
      watch(output, values)();
      expect(values).toEqual([12]);
      expect(c.started).toHaveBeenCalledTimes(2);
      expect(c.stopped).toHaveBeenCalledTimes(2);
      expect(c.get()).not.toBe(output);
    });
  });
});