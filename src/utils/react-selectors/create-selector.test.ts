import { signal, type ReadonlySignal } from "@preact/signals-react";
import type { Observable } from "kefir";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { StoreState } from "../../types";
import type { Collection } from "../collections/collection-utils";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";
import { StoreRuntime } from "../../store-runtime";

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
import { createKefirPropertyFromSubscribe } from "../selector-core/kefir-selector";

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

class MockSignalRuntimeStore<TState extends StoreState> extends StoreRuntime<any, any> {
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