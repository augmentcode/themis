import Kefir, { type Observable } from "kefir";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { StoreState } from "../../types";
import type { Collection } from "../collections/collection-utils";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";

const mocks = vi.hoisted(() => ({
  select: vi.fn((selector: unknown, ...args: unknown[]) => ({ kind: "select", selector, args })),
}));

vi.mock("typed-redux-saga", () => ({
  select: mocks.select,
}));

import {
  createCollectionItemSelector,
  createCollectionItemsListSelector,
  createSelector,
  type StoreStreamingStateSource,
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

const createMutableProperty = <T>(initialValue: T) => {
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
    set(value: T) {
      emit?.(value);
    },
  };
};

const createMockStoreBinding = <TState extends StoreState>(
  streamState: Observable<TState, any>
): StoreStreamingStateSource<TState> => ({
  getStreamState: vi.fn(() => streamState),
});

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

  it("returns a Kefir stream from direct selector invocation and emits selected values", () => {
    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const multiplier = createMutableProperty(3);
    const selectorStore = createMockStoreBinding(state.stream);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });
    const values: number[] = [];

    const selected = selectScaledCount(multiplier.stream);
    expect(selected).toBeInstanceOf(Kefir.Observable);
    const subscription = selected.observe((value) => values.push(value));
    multiplier.set(4);
    state.set(withUtility({ counter: { count: 5 } }));
    expect(values).toEqual([6]);
    vi.advanceTimersByTime(0);
    subscription.unsubscribe();

    expect(values).toEqual([6, 20]);
  });

  it("coalesces observable argument bursts to the latest selector result", () => {
    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const multiplier = createMutableProperty(3);
    const selectorStore = createMockStoreBinding(state.stream);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });
    const values: number[] = [];

    const subscription = selectScaledCount(multiplier.stream).observe((value) => values.push(value));
    multiplier.set(4);
    multiplier.set(5);
    expect(values).toEqual([6]);

    vi.advanceTimersByTime(0);
    subscription.unsubscribe();

    expect(values).toEqual([6, 10]);
  });

  it("reuses selector observable outputs for the same state source, selector, and arguments", () => {
    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(state.stream);
    const selectScaledCount = createSelector(selectorStore, (state, factor: number) => {
      return state.counter.count * factor;
    });

    expect(selectScaledCount(3)).toBe(selectScaledCount(3));
    expect(selectScaledCount(3)).not.toBe(selectScaledCount(4));
  });

  it("keys cached selector observables by object identity and argument order", () => {
    type LabelArg = { label: string };

    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(state.stream);
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

  it("keys cached selector observables by the resolved explicit stream observable", () => {
    const defaultState = createMutableProperty<CounterState>(withUtility({ counter: { count: 1 } }));
    const sharedOverrideState = createMutableProperty<CounterState>(withUtility({ counter: { count: 5 } }));
    const separateOverrideState = createMutableProperty<CounterState>(withUtility({ counter: { count: 5 } }));
    const selectorStore = createMockStoreBinding(defaultState.stream);
    const overrideStoreA = createMockStoreBinding(sharedOverrideState.stream);
    const overrideStoreB = createMockStoreBinding(sharedOverrideState.stream);
    const overrideStoreC = createMockStoreBinding(separateOverrideState.stream);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const selectCountFromA = selectCount.withStore(overrideStoreA);
    const selectCountFromB = selectCount.withStore(overrideStoreB);
    const selectCountFromC = selectCount.withStore(overrideStoreC);

    expect(selectCountFromA()).toBe(selectCountFromA());
    expect(selectCountFromA()).toBe(selectCountFromB());
    expect(selectCountFromA()).toBe(selectCount.withStore(sharedOverrideState.stream)());
    expect(selectCount()).not.toBe(selectCountFromA());
    expect(selectCountFromA()).not.toBe(selectCountFromC());
  });

  it("reads selector cache locks from the internal store utility domain", () => {
    const state = createMutableProperty<CounterState>(withUtility({ counter: { count: 2 } }));
    const selectorStore = createMockStoreBinding(state.stream);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const values: number[] = [];

    const subscription = selectCount().observe((value) => values.push(value));
    state.set({ counter: { count: 5 }, [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: true } });
    state.set({ counter: { count: 7 }, [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false } });
    vi.advanceTimersByTime(0);
    subscription.unsubscribe();

    expect(values).toEqual([2, 7]);
  });

  it("creates stream selectors bound to an explicit stream source with .withStore()", () => {
    const initialState = withUtility({ counter: { count: 1 } });
    const defaultState = createMutableProperty<CounterState>(initialState);
    const overrideState = createMutableProperty<CounterState>(withUtility({ counter: { count: 5 } }));
    const selectorStore = createMockStoreBinding(defaultState.stream);
    const overrideStore = createMockStoreBinding(overrideState.stream);
    const selectCount = createSelector(selectorStore, (state) => state.counter.count);
    const values: number[] = [];

    const boundSelector = selectCount.withStore(overrideStore);
    expectTypeOf(boundSelector()).toEqualTypeOf<Observable<number, any>>();
    const subscription = boundSelector().observe((value) => values.push(value));
    defaultState.set(withUtility({ counter: { count: 3 } }));
    overrideState.set(withUtility({ counter: { count: 6 } }));
    vi.advanceTimersByTime(0);
    subscription.unsubscribe();

    expect(overrideStore.getStreamState).toHaveBeenCalledTimes(1);
    expect(values).toEqual([5, 6]);
  });

  it("rejects the old standalone selector function shape at runtime", () => {
    const selectorFn = (state: CounterState) => state.counter.count;

    expect(() => (createSelector as unknown as (selectorFunc: unknown) => unknown)(selectorFn)).toThrow(
      "createSelector requires a streaming state source as the first argument."
    );
  });
});

describe("streaming collection selector helpers", () => {
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
    const selectorStore = createMockStoreBinding(Kefir.constant(state));
    const selectTodo = createCollectionItemSelector<Todo, "id">(selectorStore, selectTodosCollection);

    const found = selectTodo.select(state, "b");
    const missing = selectTodo.select(state, "missing");

    expectTypeOf(found).toEqualTypeOf<Todo | undefined>();
    expect(found).toEqual({ id: "b", text: "Review tests", completed: true });
    expect(missing).toBeUndefined();
    expect(selectTodo.select(state, "")).toBeUndefined();
  });

  it("creates ordered list selectors with optional item filtering", () => {
    const selectorStore = createMockStoreBinding(Kefir.constant(state));
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
