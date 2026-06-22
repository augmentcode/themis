import { signal, type ReadonlySignal } from "@preact/signals-react";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { StoreState } from "../../types";
import type { Collection } from "../collections/collection-utils";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";

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

import {
  createCollectionItemSelector,
  createCollectionItemsListSelector,
  createSelector,
  type StoreSignalStateSource,
} from "./create-selector";

type CounterState = StoreState & {
  counter: { count: number };
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: boolean };
};

type Todo = { id: string; text: string; completed: boolean };
type InternalUtilityTestState = {
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: boolean };
};

const withUtility = <T extends StoreState>(state: T): T & InternalUtilityTestState => ({
  ...state,
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false },
});

const createMockStoreBinding = <TState extends StoreState>(
  signalState: ReadonlySignal<TState>
): StoreSignalStateSource<TState> => ({
  getSignalState: vi.fn(() => signalState),
});

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
    expect(values).toEqual([6]);
    vi.advanceTimersByTime(0);
    unsubscribe();

    expect(values).toEqual([6, 20]);
  });

  it("coalesces signal argument bursts to the latest selector result", () => {
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
    expect(values).toEqual([6]);

    vi.advanceTimersByTime(0);
    unsubscribe();

    expect(values).toEqual([6, 10]);
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

    expect(overrideStore.getSignalState).toHaveBeenCalledTimes(2);
    expect(values).toEqual([5, 6]);
  });

  it("exposes .useValue() as a React signal hook read of the selector value", () => {
    const state = signal<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(state);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);

    expect(selectCount.useValue()).toBe(2);
    expect(mocks.useSignals).toHaveBeenCalledTimes(1);
  });

  it("propagates Store.getSignalState() initialization guard errors", () => {
    const selectorStore: StoreSignalStateSource<CounterState> = {
      getSignalState: vi.fn(() => {
        throw new Error("Cannot access ReactStore.getSignalState() before Store.init() has been called.");
      }),
    };
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);

    expect(() => selectCount()).toThrow(
      "Cannot access ReactStore.getSignalState() before Store.init() has been called."
    );
  });

  it("rejects the old standalone selector function shape at runtime", () => {
    const selectorFn = (state: CounterState) => state.counter.count;

    expect(() => (createSelector as unknown as (selectorFunc: unknown) => unknown)(selectorFn)).toThrow(
      "createSelector requires a signal state source as the first argument."
    );
  });
});

describe("react collection selector helpers", () => {
  const todos: Collection<Todo, "id"> = {
    idField: "id",
    ids: ["a", "b"],
    map: {
      a: { id: "a", text: "Write tests", completed: false },
      b: { id: "b", text: "Review tests", completed: true },
    },
    refsCount: {},
  };
  const state = withUtility({ todos });
  const selectTodosCollection = (state: StoreState): Collection<Todo, "id"> => state.todos;

  it("creates item selectors with typed undefined handling", () => {
    const selectorStore = createMockStoreBinding(signal(state));
    const selectTodo = createCollectionItemSelector<Todo, "id">(selectorStore, selectTodosCollection);

    const found = selectTodo.select(state, "b");
    const missing = selectTodo.select(state, "missing");

    expectTypeOf(found).toEqualTypeOf<Todo | undefined>();
    expect(found).toEqual({ id: "b", text: "Review tests", completed: true });
    expect(missing).toBeUndefined();
    expect(selectTodo.select(state, "")).toBeUndefined();
  });

  it("creates ordered list selectors with optional item filtering", () => {
    const selectorStore = createMockStoreBinding(signal(state));
    const selectTodos = createCollectionItemsListSelector<Todo, "id", (todo: Todo) => boolean>(
      selectorStore,
      selectTodosCollection
    );
    const selectCompletedTodos = createCollectionItemsListSelector<Todo, "id", (todo: Todo) => boolean>(
      selectorStore,
      selectTodosCollection,
      (todo) => todo.completed
    );

    const allTodos = selectTodos.select(state);
    const completedTodos = selectCompletedTodos.select(state);

    expectTypeOf(allTodos).toEqualTypeOf<Todo[]>();
    expect(allTodos.map((todo) => todo.id)).toEqual(["a", "b"]);
    expect(completedTodos).toEqual([{ id: "b", text: "Review tests", completed: true }]);
  });
});