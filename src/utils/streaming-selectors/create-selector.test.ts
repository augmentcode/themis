import Kefir, { type Observable } from "kefir";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { StoreState } from "../../types";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";
import { StreamingStore } from "../../streaming-store";

const mocks = vi.hoisted(() => ({
  select: vi.fn((selector: unknown, ...args: unknown[]) => ({ kind: "select", selector, args })),
}));

vi.mock("typed-redux-saga", () => ({
  select: mocks.select,
}));

import { createSelector } from "./create-selector";

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

class MockStreamingRuntimeStore<TState extends StoreState> extends StreamingStore<any, any> {
  readonly getStoreStateStreamMock = vi.fn();
  readonly getStoreStateSnapshotMock = vi.fn();

  constructor(
    private readonly stateStream: Observable<TState, any>,
    private readonly readState: () => TState,
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

const createMutableProperty = <T>(initialValue: T) => {
  let currentValue = initialValue;
  let emit: ((value: T) => void) | undefined;
  const stream = Kefir.stream<T, never>((emitter) => {
    emit = (value) => {
      emitter.value(value);
    };
    return () => {
      emit = undefined;
    };
  }).toProperty(() => initialValue);

  return {
    stream,
    get() {
      return currentValue;
    },
    set(value: T) {
      currentValue = value;
      emit?.(value);
    },
  };
};

const createMockStoreBinding = <TState extends StoreState>(
  streamState: Observable<TState, any>
): MockStreamingRuntimeStore<TState> => {
  const getSnapshot = vi.fn(() => {
    throw new Error("Test runtime streaming state source requires an explicit snapshot.");
  });

  return new MockStreamingRuntimeStore(streamState, getSnapshot);
};

const createMockRuntimeStoreBinding = <TState extends StoreState>(
  streamState: Observable<TState, any>,
  getSnapshot: () => TState
): MockStreamingRuntimeStore<TState> => new MockStreamingRuntimeStore(streamState, getSnapshot);

const assertPlainStreamingStateSourceRejected = () => {
  const state = withUtility({ counter: { count: 1 } });
  const plainStoreLike = {
    state,
    getStoreStateStream: () => Kefir.constant(state),
    getStoreStateSnapshot: () => state,
  };

  // @ts-expect-error Plain structural state sources are not StreamingStore instances.
  createSelector(plainStoreLike, (state) => state.counter.count);
};
void assertPlainStreamingStateSourceRejected;

describe("streaming createSelector", () => {
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
    const selectorStore = createMockStoreBinding(Kefir.constant(state));
    const selectGreeting = createSelector(selectorStore, selectorFn);

    expect(selectGreeting.select).toBe(selectorFn);
    expect(selectGreeting.select(state, "Hello")).toBe("Hello, Ada");
    expect(selectorFn).toHaveBeenCalledWith(state, "Hello");
  });

  it("delegates .effect() to typed-redux-saga select", () => {
    const selectorFn = (state: StoreState, id: string) => state.users[id];
    const selectorStore = createMockStoreBinding(Kefir.constant(withUtility({ users: { u1: "Ada" } })));
    const selectUser = createSelector(selectorStore, selectorFn);

    expect(selectUser.effect("u1")).toEqual({ kind: "select", selector: selectorFn, args: ["u1"] });
    expect(mocks.select).toHaveBeenCalledWith(selectorFn, "u1");
  });

  it("does not resolve stream state until a direct selector output is requested", () => {
    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockRuntimeStoreBinding(state.stream, state.get);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);

    expect(selectorStore.getStoreStateStreamMock).not.toHaveBeenCalled();
    const selected = selectCount();

    expect(selected).toBeInstanceOf(Kefir.Observable);
    expect(selectorStore.getStoreStateStreamMock).toHaveBeenCalledTimes(1);
  });

  it("returns a Kefir stream from direct selector invocation and emits selected values", () => {
    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const multiplier = createMutableProperty(3);
    const selectorStore = createMockRuntimeStoreBinding(state.stream, state.get);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });
    const values: number[] = [];

    const selected = selectScaledCount(multiplier.stream);
    expect(selected).toBeInstanceOf(Kefir.Observable);
    const subscription = selected.observe((value) => values.push(value));
    multiplier.set(4);
    state.set(withUtility({ counter: { count: 5 } }));
    expect(values).toEqual([6, 8, 20]);
    vi.advanceTimersByTime(0);
    subscription.unsubscribe();

    expect(values).toEqual([6, 8, 20]);
  });

  it("emits observable argument changes immediately when the selector result changes", () => {
    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const multiplier = createMutableProperty(3);
    const selectorStore = createMockRuntimeStoreBinding(state.stream, state.get);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });
    const values: number[] = [];

    const subscription = selectScaledCount(multiplier.stream).observe((value) => values.push(value));
    multiplier.set(4);
    multiplier.set(5);
    expect(values).toEqual([6, 8, 10]);

    vi.advanceTimersByTime(0);
    subscription.unsubscribe();

    expect(values).toEqual([6, 8, 10]);
  });

  it("reuses selector observable outputs for the same state source, selector, and arguments", () => {
    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockRuntimeStoreBinding(state.stream, state.get);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });

    expect(selectScaledCount(3)).toBe(selectScaledCount(3));
    expect(selectScaledCount(3)).not.toBe(selectScaledCount(4));
  });

  it("keys cached selector observables by object identity and argument order", () => {
    type LabelArg = { label: string };

    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockRuntimeStoreBinding(state.stream, state.get);
    const objectArg = { label: "shared" };
    const sameShapeObjectArg = { label: "shared" };
    const selectOrderedArgs = createSelector(
      selectorStore,
      (_state, first: string | LabelArg, second: string | LabelArg) => [first, second]
    );

    expect(selectOrderedArgs(objectArg, "suffix")).toBe(selectOrderedArgs(objectArg, "suffix"));
    expect(selectOrderedArgs(objectArg, "suffix")).not.toBe(selectOrderedArgs(sameShapeObjectArg, "suffix"));
    expect(selectOrderedArgs(objectArg, "suffix")).not.toBe(selectOrderedArgs("suffix", objectArg));
  });

  it("keys cached selector observables by explicit Store-like source identity", () => {
    const defaultState = createMutableProperty<CounterState>(withUtility({ counter: { count: 1 } }));
    const sharedOverrideState = createMutableProperty<CounterState>(withUtility({ counter: { count: 5 } }));
    const separateOverrideState = createMutableProperty<CounterState>(withUtility({ counter: { count: 5 } }));
    const selectorStore = createMockRuntimeStoreBinding(defaultState.stream, defaultState.get);
    const overrideStoreA = createMockRuntimeStoreBinding(sharedOverrideState.stream, sharedOverrideState.get);
    const overrideStoreB = createMockRuntimeStoreBinding(sharedOverrideState.stream, sharedOverrideState.get);
    const overrideStoreC = createMockRuntimeStoreBinding(separateOverrideState.stream, separateOverrideState.get);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const selectCountFromA = selectCount.withStore(overrideStoreA);
    const selectCountFromB = selectCount.withStore(overrideStoreB);
    const selectCountFromC = selectCount.withStore(overrideStoreC);

    expect(selectCountFromA()).toBe(selectCountFromA());
    expect(selectCountFromA()).not.toBe(selectCountFromB());
    expect(selectCount()).not.toBe(selectCountFromA());
    expect(selectCountFromA()).not.toBe(selectCountFromC());
  });

  it("reads selector cache locks from the internal store utility domain", () => {
    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockRuntimeStoreBinding(state.stream, state.get);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const values: number[] = [];

    const subscription = selectCount().observe((value) => values.push(value));
    state.set({ counter: { count: 5 }, [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: true } });
    state.set({ counter: { count: 7 }, [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false } });
    vi.advanceTimersByTime(0);
    subscription.unsubscribe();

    expect(values).toEqual([2, 7]);
  });

  it("propagates StoreRuntime state stream initialization guard errors", () => {
    const state = withUtility({ counter: { count: 0 } });
    const selectorStore = new MockStreamingRuntimeStore(
      Kefir.constant(state),
      () => state,
      new Error("Cannot access StoreRuntime.getStoreStateStream() before Store.init() has been called.")
    );
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);

    expect(() => selectCount()).toThrow(
      "Cannot access StoreRuntime.getStoreStateStream() before Store.init() has been called."
    );
  });

  it("creates stream selectors bound to an explicit stream source with .withStore()", () => {
    const initialState = withUtility({ counter: { count: 1 } });
    const defaultState = createMutableProperty<CounterState>(initialState);
    const overrideState = createMutableProperty<CounterState>(withUtility({ counter: { count: 5 } }));
    const selectorStore = createMockRuntimeStoreBinding(defaultState.stream, defaultState.get);
    const overrideStore = createMockRuntimeStoreBinding(overrideState.stream, overrideState.get);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const values: number[] = [];

    const boundSelector = selectCount.withStore(overrideStore);
    expect(overrideStore.getStoreStateStreamMock).not.toHaveBeenCalled();
    const selected = boundSelector();
    expectTypeOf(selected).toEqualTypeOf<Observable<number, any>>();
    const subscription = selected.observe((value) => values.push(value));
    defaultState.set(withUtility({ counter: { count: 3 } }));
    overrideState.set(withUtility({ counter: { count: 6 } }));
    vi.advanceTimersByTime(0);
    subscription.unsubscribe();

    expect(overrideStore.getStoreStateStreamMock).toHaveBeenCalledTimes(1);
    expect(values).toEqual([5, 6]);
  });

  it("rejects the old standalone selector function shape at runtime", () => {
    const selectorFn = (state: CounterState) => state.counter.count;

    expect(() => (createSelector as unknown as (selectorFunc: unknown) => unknown)(selectorFn)).toThrow(
      "createSelector requires a Store-like state source as the first argument."
    );
  });

  it("evicts an observable only after its final observer leaves", () => {
    const state = createMutableProperty(withUtility({ counter: { count: 1 } }));
    const selectorStore = createMockRuntimeStoreBinding(state.stream, state.get);
    const selectScaled = createSelector(selectorStore, (value, factor: number) => value.counter.count * factor);
    const first = selectScaled(2);
    const concurrent = selectScaled(3);
    const firstSubscriptionA = first.observe(() => {});
    const firstSubscriptionB = first.observe(() => {});
    const concurrentSubscription = concurrent.observe(() => {});

    expect(selectScaled(2)).toBe(first);
    firstSubscriptionA.unsubscribe();
    expect(selectScaled(2)).toBe(first);
    concurrentSubscription.unsubscribe();
    firstSubscriptionB.unsubscribe();

    const stateSubscription = state.stream.observe(() => {});
    state.set(withUtility({ counter: { count: 5 } }));
    const fresh = selectScaled(2);
    expect(fresh).not.toBe(first);
    const values: number[] = [];
    const freshSubscription = fresh.observe((value) => values.push(value));
    freshSubscription.unsubscribe();
    stateSubscription.unsubscribe();
    expect(values).toEqual([10]);
    expect(selectScaled(3)).not.toBe(concurrent);
  });
});
