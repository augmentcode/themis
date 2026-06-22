# Testing Guide

> **How to test reducers, selectors, and sagas.**

---

## Table of Contents

1. [Overview](#overview)
2. [Testing Reducers](#testing-reducers)
3. [Testing Selectors](#testing-selectors)
4. [Testing Sagas](#testing-sagas)
5. [Mock Store Setup](#mock-store-setup)
6. [Tips and Patterns](#tips-and-patterns)

---

## Overview

The testing approach for each layer follows from its design:

| Layer | Nature | Testing Approach |
|-------|--------|-----------------|
| Reducers | Pure functions | Call directly with state + action, assert result |
| Selectors | Pure functions | Call `.select(state)` with mock state, assert result |
| Sagas | Generators with effects | Use `redux-saga-test-plan` or step through manually |

Use [Vitest](https://vitest.dev/) as the test runner.

---

## Testing Reducers

Reducers are pure functions: given (state, action) → new state. Test them directly.

### Basic Pattern

```typescript
import { describe, it, expect } from "vitest";
import { counterReducer, increment, decrement, setCount } from "./counter-slice";

describe("counterReducer", () => {
  const initialState = { value: 0, lastUpdated: null };

  it("should return initial state for undefined state", () => {
    const state = counterReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  it("should handle increment", () => {
    const state = counterReducer(initialState, increment());
    expect(state.value).toBe(1);
  });

  it("should handle setCount with payload", () => {
    const state = counterReducer(initialState, setCount(42));
    expect(state.value).toBe(42);
  });

  it("should return same state for unknown action", () => {
    const state = counterReducer(initialState, { type: "unknown" });
    expect(state).toBe(initialState); // Same reference
  });
});
```

### Testing Async Action Handlers

```typescript
import { itemsReducer, fetchItems } from "./items-slice";

describe("itemsReducer async actions", () => {
  const initialState = { items: [], isLoading: false, error: null };

  it("should set loading on fetch request", () => {
    const state = itemsReducer(initialState, fetchItems("query"));
    expect(state.isLoading).toBe(true);
    expect(state.error).toBeNull();
  });

  it("should store items on success", () => {
    const items = [{ id: "1", name: "Item 1" }];
    const state = itemsReducer(
      { ...initialState, isLoading: true },
      fetchItems.success({ response: { items, total: 1 } })
    );
    expect(state.isLoading).toBe(false);
    expect(state.items).toEqual(items);
  });

  it("should store error on failure", () => {
    const state = itemsReducer(
      { ...initialState, isLoading: true },
      fetchItems.failure({ error: new Error("Network error") })
    );
    expect(state.isLoading).toBe(false);
    expect(state.error).toBe("Network error");
  });
});
```

### Testing Collection Operations

```typescript
import { todosReducer, addTodo, removeTodo } from "./todos-slice";
import { getItem, getItems } from "@augmentcode/themis/utils/collections/collection-utils";

describe("todosReducer collections", () => {
  it("should add a todo to the collection", () => {
    const state = todosReducer(undefined, addTodo({ id: "1", title: "Test", completed: false }));
    expect(getItem(state.collection, "1")).toEqual({
      id: "1", title: "Test", completed: false,
    });
  });

  it("should remove a todo from the collection", () => {
    let state = todosReducer(undefined, addTodo({ id: "1", title: "Test", completed: false }));
    state = todosReducer(state, removeTodo("1"));
    expect(getItems(state.collection)).toHaveLength(0);
  });
});
```

---

## Testing Selectors

Selectors are pure functions. Call `.select(state)` with a mock state object.

```typescript
import { describe, it, expect } from "vitest";
import { selectCompletedTodos, selectTodoById } from "./todos-selectors";
import { createCollection } from "@augmentcode/themis/utils/collections/collection-utils";

describe("selectCompletedTodos", () => {
  const mockState = {
    todos: {
      collection: createCollection("id", [
        { id: "1", title: "Done", completed: true },
        { id: "2", title: "Pending", completed: false },
      ]),
    },
  };

  it("should return only completed todos", () => {
    const result = selectCompletedTodos.select(mockState);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });
});

### Manual Generator Stepping

For more control, step through the generator manually:

```typescript
import { describe, it, expect } from "vitest";
import { call, put } from "typed-redux-saga";
import { handleFetch } from "./my-saga";
import * as api from "../api";

describe("handleFetch (manual)", () => {
  it("should call API and dispatch success", () => {
    const action = fetchItems("query");
    const gen = handleFetch(action);

    // Step 1: call the API
    expect(gen.next().value).toEqual(call(api.fetchItems, "query"));

    // Step 2: dispatch success with the result
    const items = [{ id: "1" }];
    expect(gen.next(items).value).toEqual(put(setItems(items)));

    // Step 3: done
    expect(gen.next().done).toBe(true);
  });

  it("should dispatch failure on error", () => {
    const action = fetchItems("query");
    const gen = handleFetch(action);

    gen.next(); // Advance to call
    const error = new Error("Network error");
    expect(gen.throw(error).value).toEqual(put(fetchFailed(error.message)));
  });
});
```

---

## Mock Store Setup

For integration-style tests that need a real store:

```typescript
import { describe, it, expect } from "vitest";
import { Store } from "@augmentcode/themis/svelte-store";

function createTestStore(overrides = {}) {
  const store = new Store({
    todos: todosReducer,
    ...overrides,
  });
  store.init();
  return store;
}

describe("integration test", () => {
  it("should handle full action flow", () => {
    const store = createTestStore();
    store.dispatch(addTodo({ id: "1", title: "Test", completed: false }));

    const state = store.state;
    expect(selectTodoById.select(state, "1")?.title).toBe("Test");
  });
});
```

Use `Store` from `@augmentcode/themis/svelte-store` when a test needs Svelte-readable selector behavior. Use `StreamingStore` from `@augmentcode/themis/streaming-store` when asserting Kefir stream emissions from `store.createSelector(...)` calls; continue to use `.select(mockState, ...args)` for pure selector assertions. For direct streaming emission tests, use controlled timers or a mocked `requestAnimationFrame` to advance the selector throttle and assert that rapid Store or observable argument updates coalesce to the latest value.

---

## Tips and Patterns

1. **Test reducers exhaustively** — They are pure and fast. Cover every action type, edge cases, and identity returns.

2. **Test selector composition** — If `selectB` depends on `selectA`, test both independently AND together.

3. **Use `.select()` in tests** — Never call `selector()` (the readable form) in tests, as it requires Svelte component context.

4. **Assert immutability** — Verify that the original state is never mutated:

   ```typescript
   it("should not mutate original state", () => {
     const original = { ...initialState };
     const frozen = Object.freeze(original);
     // Should not throw
     const newState = myReducer(frozen, myAction());
     expect(newState).not.toBe(frozen);
   });
   ```

5. **Test serialization** — Ensure state is always JSON-serializable:

   ```typescript
   it("should produce serializable state", () => {
     const state = myReducer(undefined, myAction());
     expect(() => JSON.stringify(state)).not.toThrow();
     expect(JSON.parse(JSON.stringify(state))).toEqual(state);
   });
   ```

6. **Use `silentRun()` in saga tests** — Suppresses timeout warnings for faster tests.

7. **Review refactor cleanup** — When a change moves, renames, or splits modules,
   inspect the old paths from the diff. Remove old modules that are now only
   one-line re-exports, import/export proxies, or delegate-only wrappers, or add
   an adjacent compatibility-shim comment that states the consumer/release window
   and sunset/removal condition. Summaries should call out either “no pass-through
   wrappers” or list the justified shims.

8. **File naming convention** — Test files live next to the code: `my-slice.test.ts`, `my-saga.test.ts`.

9. **Run the architecture-backed test examples check** — Changes to tests,
   README snippets, docs, or skills should run `npm run validate:architecture`.
   This command includes ESLint-backed
   test-pattern rules for selector tests and `typed-redux-saga` mocks. A failure
   points at the source test file or Markdown fence and includes `Why:` plus
   `How to fix:` guidance. Fix selector-test failures by using
   `selectFoo.select(mockState, ...args)`; fix `typed-redux-saga` mock failures
   by preserving the `Array.isArray(fnOrDescriptor)` branch for tuple call
   descriptors. Mark intentionally bad Markdown teaching examples as wrong/bad
   rather than leaving them indistinguishable from recommended snippets.