import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { get, writable, type Writable } from "svelte/store";
import type { Observable as KefirObservable } from "kefir";
import type { StoreState } from "../../types";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";
import { Store } from "../../svelte-store";

const mocks = vi.hoisted(() => ({
  select: vi.fn((selector: unknown, ...args: unknown[]) => ({ kind: "select", selector, args })),
}));

vi.mock("typed-redux-saga", () => ({
  select: mocks.select,
}));

import { createKefirPropertyFromSubscribe } from "../selector-core/kefir-selector";
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

class MockReadableRuntimeStore<TState extends StoreState> extends Store<any, any> {
  readonly getStoreStateStreamMock = vi.fn();
  readonly getStoreStateSnapshotMock = vi.fn();

  constructor(
    private readonly readState: () => TState,
    private readonly stateStream: KefirObservable<TState, any>,
    private readonly streamError?: Error
  ) {
    super();
  }

  override get state(): TState {
    return this.readState();
  }

  override getStoreStateStream(): KefirObservable<TState, any> {
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
  storeState: Writable<TState>
): MockReadableRuntimeStore<TState> => {
  const stateStream = createKefirPropertyFromSubscribe(
    () => get(storeState),
    (listener) => storeState.subscribe(listener)
  );

  return new MockReadableRuntimeStore(() => get(storeState), stateStream);
};

const assertPlainReadableStateSourceRejected = () => {
  const state = withUtility({ counter: { count: 1 } });
  const plainStoreLike = {
    state,
    getStoreStateStream: () => createKefirPropertyFromSubscribe(() => state, () => () => {}),
    getStoreStateSnapshot: () => state,
  };

  // @ts-expect-error Plain structural state sources are not Store instances.
  createSelector(plainStoreLike, (state) => state.counter.count);
};
void assertPlainReadableStateSourceRejected;

describe("createSelector", () => {
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
    const selectorStore = createMockStoreBinding(writable(withUtility({ user: { name: "Ada" } })));
    const selectGreeting = createSelector(selectorStore, selectorFn);
    const state = withUtility({ user: { name: "Ada" } });

    expect(selectGreeting.select).toBe(selectorFn);
    expect(selectGreeting.select(state, "Hello")).toBe("Hello, Ada");
    expect(selectorFn).toHaveBeenCalledWith(state, "Hello");
  });

  it("delegates .effect() to typed-redux-saga select", () => {
    const selectorFn = (state: StoreState, id: string) => state.users[id];
    const selectorStore = createMockStoreBinding(writable(withUtility({ users: { u1: "Ada" } })));
    const selectUser = createSelector(selectorStore, selectorFn);

    expect(selectUser.effect("u1")).toEqual({ kind: "select", selector: selectorFn, args: ["u1"] });
    expect(mocks.select).toHaveBeenCalledWith(selectorFn, "u1");
  });

  it("creates readable selectors from the StoreRuntime Kefir state source", () => {
    const storeState = writable<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(storeState);
    const multiplier = writable(3);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });
    const values: number[] = [];

    const unsubscribe = selectScaledCount(multiplier).subscribe((value) => values.push(value));
    multiplier.set(4);
    vi.advanceTimersByTime(16);
    storeState.set(withUtility({ counter: { count: 5 } }));
    vi.advanceTimersByTime(16);
    unsubscribe();

    expect(values).toEqual([6, 8, 20]);
  });

  it("reuses selector readable outputs for the same state source, selector, and arguments", () => {
    const storeState = writable<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(storeState);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });

    expect(selectScaledCount(3)).toBe(selectScaledCount(3));
    expect(selectScaledCount(3)).not.toBe(selectScaledCount(4));
  });

  it("reuses selector readables by Store-like source identity", () => {
    const storeState = writable<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(storeState);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);

    expect(selectCount()).toBe(selectCount());
    expect(selectorStore.getStoreStateStreamMock).toHaveBeenCalledTimes(1);
  });

  it("keys cached selector readables by object identity and argument order", () => {
    type LabelArg = { label: string };

    const storeState = writable<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(storeState);
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

  it("reads selector cache locks from the internal store utility domain", () => {
    const storeState = writable<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(storeState);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const values: number[] = [];

    const unsubscribe = selectCount().subscribe((value) => values.push(value));
    storeState.set({ counter: { count: 5 }, [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: true } });
    storeState.set({ counter: { count: 7 }, [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false } });
    vi.advanceTimersByTime(16);
    unsubscribe();

    expect(values).toEqual([2, 7]);
  });

  it("propagates StoreRuntime state stream initialization guard errors", () => {
    const state = withUtility({ counter: { count: 0 } });
    const selectorStore = new MockReadableRuntimeStore(
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

  it("creates readable selectors bound to an explicit Store-like source with .withStore()", () => {
    const selectorStore = createMockStoreBinding(writable<CounterState>(withUtility({ counter: { count: 1 } })));
    const overrideState = writable<CounterState>(withUtility({ counter: { count: 5 } }));
    const overrideStore = createMockStoreBinding(overrideState);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const values: number[] = [];

    const unsubscribe = selectCount.withStore(overrideStore)().subscribe((value) => values.push(value));
    overrideState.set(withUtility({ counter: { count: 7 } }));
    vi.advanceTimersByTime(16);
    unsubscribe();

    expect(overrideStore.getStoreStateStreamMock).toHaveBeenCalledTimes(1);
    expect(values).toEqual([5, 7]);
  });

  it("does not share cached selector readables across explicit Store-like sources", () => {
    const initialStateA = withUtility({ counter: { count: 1 } });
    const initialStateB = withUtility({ counter: { count: 5 } });
    const storeA = createMockStoreBinding(writable<CounterState>(initialStateA));
    const storeB = createMockStoreBinding(writable<CounterState>(initialStateB));
    const selectorStore = createMockStoreBinding(writable<CounterState>(initialStateA));
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const selectCountFromA = selectCount.withStore(storeA);
    const selectCountFromB = selectCount.withStore(storeB);

    expect(selectCountFromA()).toBe(selectCountFromA());
    expect(selectCountFromA()).not.toBe(selectCountFromB());
  });

  it("does not share cached selector readables across Store-like wrappers around shared state", () => {
    const sharedStoreState = writable<CounterState>(withUtility({ counter: { count: 1 } }));
    const sourceA = createMockStoreBinding(sharedStoreState);
    const sourceB = createMockStoreBinding(sharedStoreState);
    const selectCount = createSelector(sourceA, (state) => state.counter.count);
    const selectCountFromA = selectCount.withStore(sourceA);
    const selectCountFromB = selectCount.withStore(sourceB);

    expect(selectCountFromA()).toBe(selectCountFromA());
    expect(selectCountFromA()).not.toBe(selectCountFromB());
  });
});
