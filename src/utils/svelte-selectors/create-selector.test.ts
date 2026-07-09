import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { writable, type Writable } from "svelte/store";
import type { Observable, UnknownAction } from "redux";
import type { ReduxStore } from "../../internal-types";
import type { StoreReadableStateSource, StoreState } from "../../types";
import type { Collection } from "../collections/collection-utils";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";

const mocks = vi.hoisted(() => ({
  select: vi.fn((selector: unknown, ...args: unknown[]) => ({ kind: "select", selector, args })),
}));

vi.mock("typed-redux-saga", () => ({
  select: mocks.select,
}));

import { createCollection } from "../collections/collection-utils";
import {
  createCollectionItemSelector,
  createCollectionItemsListSelector,
  createSelector,
  createSelectorFromReadableState,
} from "./create-selector";
import { createStoreStateReadable } from "./create-readable-store-state";

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

const createMockObservable = (): Observable<StoreState> => ({
  subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  [Symbol.observable]() {
    return this;
  },
});
const mockDispatch: ReduxStore["dispatch"] = <T extends UnknownAction>(action: T) => action;

const createMockStore = (initialState: StoreState) => {
  let state = initialState;
  const listeners = new Set<() => void>();
  const store = {
    dispatch: mockDispatch,
    getState: vi.fn(() => state),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    replaceReducer: vi.fn(),
    [Symbol.observable]: vi.fn(createMockObservable),
  } satisfies ReduxStore;

  return {
    store,
    setState(nextState: StoreState) {
      state = nextState;
      listeners.forEach((listener) => listener());
    },
  };
};

const createMockStoreBinding = <TState extends StoreState>(
  storeState: Writable<TState>
): StoreReadableStateSource<TState> => ({
  getReadableState: vi.fn(() => storeState),
});

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

  it("creates readable selectors from the supplied Store.getReadableState()", () => {
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

  it("reuses direct selector readables without a selector-argument cache key", () => {
    const storeState = writable<CounterState>(withUtility({ counter: { count: 2 } }));
    const getReadableState = vi.fn(() => storeState);
    const selectCount = createSelectorFromReadableState(getReadableState, (state) => state.counter.count);

    expect(selectCount()).toBe(selectCount());
    expect(getReadableState).toHaveBeenCalledTimes(2);
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

  it("propagates Store.getReadableState() initialization guard errors", () => {
    const selectorStore: StoreReadableStateSource<CounterState> = {
      getReadableState: vi.fn(() => {
        throw new Error("Cannot access Store.getReadableState() before Store.init() has been called.");
      }),
    };
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);

    expect(() => selectCount()).toThrow(
      "Cannot access Store.getReadableState() before Store.init() has been called."
    );
  });

  it("rejects the old standalone selector function shape at runtime", () => {
    const selectorFn = (state: CounterState) => state.counter.count;

    expect(() => (createSelector as unknown as (selectorFunc: unknown) => unknown)(selectorFn)).toThrow(
      "createSelector requires a Store instance as the first argument."
    );
  });

  it("creates readable selectors bound to an explicit redux store with .withStore()", () => {
    const initialState = withUtility({ counter: { count: 1 } });
    const { store, setState } = createMockStore(initialState);
    const selectorStore = createMockStoreBinding(writable<CounterState>(initialState));
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const values: number[] = [];

    const unsubscribe = selectCount.withStore(store)().subscribe((value) => values.push(value));
    setState(withUtility({ counter: { count: 7 } }));
    vi.advanceTimersByTime(16);
    unsubscribe();
    setState(withUtility({ counter: { count: 9 } }));

    expect(store.subscribe).toHaveBeenCalledTimes(1);
    expect(values).toEqual([1, 7]);
  });

  it("does not share cached selector readables across explicit redux stores", () => {
    const initialStateA = withUtility({ counter: { count: 1 } });
    const initialStateB = withUtility({ counter: { count: 5 } });
    const { store: storeA } = createMockStore(initialStateA);
    const { store: storeB } = createMockStore(initialStateB);
    const selectorStore = createMockStoreBinding(writable<CounterState>(initialStateA));
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const selectCountFromA = selectCount.withStore(storeA);
    const selectCountFromB = selectCount.withStore(storeB);

    expect(selectCountFromA()).toBe(selectCountFromA());
    expect(selectCountFromA()).not.toBe(selectCountFromB());
  });

  it("does not share cached selector readables across explicit readable state sources", () => {
    const sourceA = createMockStoreBinding(writable<CounterState>(withUtility({ counter: { count: 1 } })));
    const sourceB = createMockStoreBinding(writable<CounterState>(withUtility({ counter: { count: 5 } })));
    const selectCount = createSelector(sourceA, (state) => state.counter.count);
    const selectCountFromA = selectCount.withStore(sourceA);
    const selectCountFromB = selectCount.withStore(sourceB);

    expect(selectCountFromA()).toBe(selectCountFromA());
    expect(selectCountFromA()).not.toBe(selectCountFromB());
  });
});

describe("createStoreStateReadable", () => {
  it("initializes from getState and emits subscribed store updates", () => {
    const initialState = withUtility({ counter: { count: 10 } });
    const { store, setState } = createMockStore(initialState);
    const readableState = createStoreStateReadable(store);
    const values: number[] = [];

    const unsubscribe = readableState.subscribe((state) => values.push(state.counter.count));
    setState(withUtility({ counter: { count: 11 } }));
    unsubscribe();
    setState(withUtility({ counter: { count: 12 } }));

    expect(values).toEqual([10, 11]);
  });
});

describe("collection selector helpers", () => {
  const todos = createCollection<Todo, "id">("id", [
    { id: "a", text: "Write tests", completed: false },
    { id: "b", text: "Review tests", completed: true },
  ]);
  const state = withUtility({ todos });
  const selectTodosCollection = (state: StoreState): Collection<Todo, "id"> => state.todos;

  it("creates item selectors with typed undefined handling", () => {
    const selectorStore = createMockStoreBinding(writable(state));
    const selectTodo = createCollectionItemSelector<Todo, "id">(selectorStore, selectTodosCollection);

    const found = selectTodo.select(state, "b");
    const missing = selectTodo.select(state, "missing");

    expectTypeOf(found).toEqualTypeOf<Todo | undefined>();
    expect(found).toEqual({ id: "b", text: "Review tests", completed: true });
    expect(missing).toBeUndefined();
    expect(selectTodo.select(state, "")).toBeUndefined();
  });

  it("creates ordered list selectors with optional item filtering", () => {
    const selectorStore = createMockStoreBinding(writable(state));
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
