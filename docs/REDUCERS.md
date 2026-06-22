# Reducers Guide

> **How to create actions, async actions, and reducers with the fluent `.with()` API.**

---

## Table of Contents

1. [Actions](#actions)
2. [Async Actions](#async-actions)
3. [Creating Reducers](#creating-reducers)
4. [Immutability Rules](#immutability-rules)
5. [State Serialization Rules](#state-serialization-rules)
6. [Best Practices](#best-practices)

---

## Actions

Actions are plain objects describing events. Use `createAction` from `@augmentcode/themis/utils/store/create-action`.

### No Payload

```typescript
import { createAction } from "@augmentcode/themis/utils/store/create-action";

export const resetCounter = createAction("counter/reset");
// dispatch(resetCounter()) → { type: "counter/reset", payload: undefined }
```

### Single Argument

```typescript
export const setCount = createAction<[value: number]>("counter/setCount");
// dispatch(setCount(42)) → { type: "counter/setCount", payload: [42] }
```

### Multiple Arguments (Tuple)

```typescript
export const setItemStatus = createAction<[id: string, status: string]>(
  "items/setStatus"
);
// dispatch(setItemStatus("abc", "active")) → { type: "items/setStatus", payload: ["abc", "active"] }
```

### Payload Modifier

Transform arguments into a different payload shape:

```typescript
export const addItem = createAction(
  "items/add",
  (name: string, priority: number) => ({ name, priority, createdAt: Date.now() })
);
// dispatch(addItem("task", 1)) → { type: "items/add", payload: { name: "task", priority: 1, createdAt: ... } }
```

**Key rules:**
- Always namespace action types: `"sliceName/actionName"`
- Use tuple types `[arg1, arg2]` for multiple arguments
- Action creators can be passed directly to `takeEvery`, `takeLatest`, `take` — no need for `.type`

---

## Async Actions

Async actions represent operations with three stages: request, success, and failure.

```typescript
import { createAsyncAction } from "@augmentcode/themis/utils/store/create-action";

export const fetchItems = createAsyncAction<
  [query: string],              // Arguments
  { items: Item[]; total: number } // Response type
>("items/fetch", "items/fetchItems");
```

### Async Action Structure

An async action creator returns:
- `type` — The action type string
- `asyncActionType` — The async operation type
- `payload` — The request payload
- `promise` — A promise that resolves with the response
- `success` — Action creator for the success case
- `failure` — Action creator for the failure case

### Handling Async Actions in Reducers

```typescript
export const itemsReducer = createReducer<ItemsState>(initialState)
  .with(fetchItems, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  }))
  .with(fetchItems.success, (state, action) => ({
    ...state,
    isLoading: false,
    items: action.payload.response.items,
  }))
  .with(fetchItems.failure, (state, action) => ({
    ...state,
    isLoading: false,
    error: action.payload.error.message,
  }));
```

---

## Creating Reducers

Use `createReducer` from `@augmentcode/themis/utils/store/create-reducer`. It provides a fluent `.with()` API for registering action handlers.

```typescript
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

// State type
type CounterState = {
  value: number;
  lastUpdated: number | null;
};

const initialState: CounterState = {
  value: 0,
  lastUpdated: null,
};

// Actions
export const increment = createAction("counter/increment");
export const decrement = createAction("counter/decrement");
export const setCount = createAction<[value: number]>("counter/setCount");

// Reducer with fluent .with() API
export const counterReducer = createReducer<CounterState>(initialState)
  .with(increment, (state) => ({
    ...state,
    value: state.value + 1,
    lastUpdated: Date.now(),
  }))
  .with(decrement, (state) => ({
    ...state,
    value: state.value - 1,
    lastUpdated: Date.now(),
  }))
  .with(setCount, (state, { payload: [value] }) => ({
    ...state,
    value,
    lastUpdated: Date.now(),
  }));
```

`createReducer` returns the reducer function itself — `.with()` registers a handler and returns the same reducer for chaining, so no `.build()` call is needed. The reducer dispatches to the registered handler by `action.type` and falls back to returning the current state for unknown actions. `reducer.initialState` is exposed for tests.

---

## Immutability Rules

Handlers must be pure and must never mutate state:

- **Never mutate** — return new objects via spreads (`{ ...state, ... }`) instead of assigning to `state` or nested objects.
- **Return the same reference for no-ops** — when an action results in no actual change, return the incoming `state` object unchanged so selector reference-equality memoization (and ref-equality test assertions) keep working.
- **Copy every changed level** — `createReducer` only shallow-compares the top-level state object, so unconditionally rebuilding nested objects loses no-op identity. Compare first, then copy only when something changed:

```typescript
.with(setSearch, (state, { payload: [query] }) =>
  state.filters.query === query
    ? state // no-op: same reference
    : { ...state, filters: { ...state.filters, query } }
);
```

---

## State Serialization Rules

Redux state **must** be fully serializable to JSON. This enables persistence, time-travel debugging, and state hydration.

### Allowed Types

```typescript
type SerializableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SerializableValue[]
  | { [key: string]: SerializableValue };
```

### Forbidden Types

| Type | Why Forbidden | Alternative |
|---|---|---|
| `Function` | Not serializable | Store function name/ID, call from saga |
| `Class instance` | Has methods, breaks immutability | Use plain objects |
| `Date` | Not serializable | Use `number` (timestamp in ms) |
| `Map` / `WeakMap` | Not serializable | Use `Record<string, T>` |
| `Set` / `WeakSet` | Not serializable | Use `Array<T>` or `Record<T, true>` |
| `RegExp` | Not serializable | Store pattern as `string` |
| `Promise` | Not serializable | Handle in sagas |
| `Symbol` | Not serializable | Use `string` constants |

### Testing Serialization

```typescript
import { describe, it, expect } from "vitest";

describe("myReducer", () => {
  it("should have serializable initial state", () => {
    const state = myReducer.initialState;
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    expect(deserialized).toEqual(state);
  });
});
```

---

## Best Practices

1. **Reuse helpers before extracting new ones** — Search existing package/application utilities before adding reducer helpers (for example, `rg "collection|selector|preference|reducer" src/utils src/slices docs skills`). Prefer documented helpers, extend them only when their contract remains intact, and document whether you reused, extended, or added code with the search terms/paths that informed the decision. Extract complex transformations into pure helper functions outside the reducer only after this check; code review should flag duplicate helpers that lack a documented reason.

2. **Use separate maps for derived state** — Don't store boolean flags on items; use a parallel `Record<string, boolean>`:

   ```typescript
   type State = {
     items: Collection<Item, "id">;
     pinnedItems: Record<string, boolean>;  // ✅ Separate map
     activeItems: Record<string, boolean>;  // ✅ Separate map
   };
   ```

3. **Avoid non-deterministic values in reducers** — Don't call `Date.now()`, `Math.random()`, or generate IDs inside reducers. Generate these values in the action creator or saga, then pass them as payload.

4. **Keep reducers fast** — Move expensive computations to sagas; store the pre-computed result.

5. **Don't store high-frequency changing values** — Values that update multiple times per second (mouse position, scroll position) should be debounced in a saga before dispatching.

