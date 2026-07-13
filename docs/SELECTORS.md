# Selectors Guide

> **How to create and use selectors with proxy-based memoization.**

---

## Table of Contents

1. [What are Selectors?](#what-are-selectors)
2. [Creating Selectors](#creating-selectors)
3. [Using Selectors](#using-selectors)
4. [Proxy-Based Memoization](#proxy-based-memoization)
5. [Collection Selectors](#collection-selectors)
6. [Selector Lifecycle Rules](#selector-lifecycle-rules)
7. [Best Practices](#best-practices)
8. [Anti-Patterns](#anti-patterns)

---

## What are Selectors?

Selectors are pure functions that extract and derive data from the Redux store. In production app code, create app-local selectors from the configured `Store` instance with `store.createSelector(...)`. The Store-bound helper delegates to the lower-level selector utility while typing the callback `state` as `StoreInstanceState<typeof store>` (`StoreState<typeof store>` remains supported). That concrete state resolves reducer domains to app state types (for example, `counter: CounterState` and `todos: TodosState`) instead of exposing reducer call signatures or helper members. Selectors provide:

- **Automatic memoization** — Proxy-based tracking of accessed state paths; only recomputes when those paths change.
- **Cached direct outputs** — Repeated direct calls with the same state source, Store-created selector, and arguments reuse the same Svelte readable, React `ReadonlySignal`, or Kefir Observable output.
- **Multiple usage modes** — Svelte reactive stores, React signals/component reads, Kefir streams, saga effects, and direct state reads.
- **Type safety** — Full TypeScript inference for arguments and return types.
- **Composability** — Selectors can call other selectors via `.select()`.

---

## Creating Selectors

Use the configured app Store as the public selector creation API for production app-local selectors. `Store` is the canonical Svelte-readable class available from `@augmentcode/themis/svelte-store`, `ReactStore` from `@augmentcode/themis/react-store` returns Preact React signals from selector calls and adds React `.useValue(...)`, and `StreamingStore` from `@augmentcode/themis/streaming-store` returns Kefir streams from selector calls. If shared code needs reusable selector logic, pass a configured Store into that helper and call `store.createSelector(...)` at the app integration boundary.

In application slices, define selectors in the owning slice directory's single `*-selectors.ts` module. A slice directory should have exactly one selectors owner next to exactly one `*-slice.ts`; if a feature grows multiple logical slices, split it into multiple slice directories instead of adding extra selectors files beside one slice owner.

```typescript
import { Store } from "@augmentcode/themis/svelte-store";
import type { StoreInstanceState } from "@augmentcode/themis/types";
import { todosReducer } from "./todos-slice";

export const store = new Store({ todos: todosReducer });
export type AppState = StoreInstanceState<typeof store>;
```

`StoreInstanceState<typeof store>` is the same shape available inside `store.createSelector` callbacks: each reducer domain is inferred as its state object, not as the reducer function or reducer helper object used to configure the Store.

Svelte-readable, React signal, and StreamingStore selector emissions default to `64` FPS. To tune coalescing, pass Store options as the final constructor argument. The value must be finite and within the inclusive `1..256` FPS range; fractional values such as `48.5` are accepted, and invalid values throw instead of clamping.

```typescript
export const store = new Store(
  { todos: todosReducer },
  undefined,
  { throttledSelectorFrequency: 48.5 }
);
```

### Simple Selector (No Arguments)

```typescript
import { store } from "$lib/store";

export const selectItemCount = store.createSelector((state) => {
  return state.todos.collection.ids.length;
});
```

### Selector with Arguments

```typescript
export const selectTodoById = store.createSelector((state, todoId: string) => {
  return state.todos.collection.map[todoId];
});
```

Prefer primitive scalar selector arguments such as ids, booleans, enum strings,
numbers, `null`, or `undefined`. Direct selector outputs are cached by argument
identity, so freshly constructed object, array, or function arguments create new
cache paths even when they are semantically equivalent. Instead of passing an
options object like `selectTodo({ id, includeArchived })`, expose scalar
parameters such as `selectTodo(id, includeArchived)`. Object or function
arguments are valid only when their identity is stable and intentional, such as a
module-level config object, memoized reference, existing source object, or a
stable reactive value supported by the selected Store family.

The same argument-stability policy applies to every selector call form:
`selectFoo(...args)`, `.select(state, ...args)`, `.effect(...args)`,
`.withStore(source)(...args)`, React `.useValue(...args)`, selector-channel args
tuples, and `waitFor` args tuples. Avoid selector callbacks that destructure an
options object argument unless the selector contract explicitly requires a
stable object identity; split the object into scalar parameters when possible.

### Composing Selectors

Call `.select()` on other selectors to reuse computations:

```typescript
export const selectCompletedTodos = store.createSelector((state) => {
  const todos = selectAllTodos.select(state);
  return todos.filter((t) => t.completed);
});

export const selectCompletedCount = store.createSelector((state) => {
  return selectCompletedTodos.select(state).length;
});
```

---

## Using Selectors

Selectors provide multiple methods for different contexts. `Store.createSelector` uses the package's Svelte-readable selector model; `ReactStore.createSelector` uses the React signal selector model and returns Preact React signals from direct calls; `StreamingStore.createSelector` uses the streaming selector model and returns Kefir streams from direct calls. Choose the Store class instead of constructor injection for selector behavior.

Direct Svelte readable, React `ReadonlySignal`, and Kefir Observable outputs are cached by source + Store-created selector + arguments. For StreamingStore, the source is the Kefir state observable. Prefer calling the same Store-bound selector with the same stable args where the consumer has a valid direct-call context, instead of props drilling or manually passing derived streams solely to avoid selector calls. Keep lifecycle rules: Svelte direct readable calls belong at component init, React signal calls belong in signal-aware React paths, streaming direct calls belong in streaming setup, and `.select`, `.effect`, `.withStore`, or React `.useValue(...)` remain the escape hatches for other contexts.

### 1. In Svelte Components (Reactive)

The default call returns a Svelte readable store:

```typescript
// At component init (top-level <script>)
const count = selectItemCount();
const todo = selectTodoById(todoId);

// Use with $store syntax in template
// {$count} items, editing {$todo?.title}
```

### 2. In React components and signal-aware code

`ReactStore` direct selector calls return `ReadonlySignal<R>` values and are the preferred React consumer integration path when components, custom hooks, or helper APIs can accept signals. Use `.useValue(...args)` only when a hook/plain value is required and adapting the consumer to accept signals is impractical.

```tsx
import { ReactStore } from "@augmentcode/themis/react-store";

export const reactStore = new ReactStore({ todos: todosReducer });
export const selectTodoById = reactStore.createSelector((state, todoId: string) => {
  return state.todos.collection.map[todoId];
});

const todoSignal = selectTodoById("todo-1");
console.log(todoSignal.value);

function TodoTitle({ id }: { id: string }) {
  const todo = selectTodoById(id);
  return <span>{todo.value?.title}</span>;
}
```

Direct signal calls and `.useValue(...args)` are throttled by the owning `ReactStore`'s `throttledSelectorFrequency`. Selector arguments may be plain values or `ReadonlySignal` values; signal arguments are read reactively by the computed selector. Keep `.useValue(...args)` for third-party components, legacy hook boundaries, or other places that must receive plain `R`.

### 3. In Sagas (`.effect()` and selector-channel helpers)

```typescript
function* mySaga() {
  const count = yield* selectItemCount.effect();
  const todo = yield* selectTodoById.effect(todoId);
}
```

`.effect(...args)` is saga-only for every Store variant. It creates a typed-redux-saga select effect over the selector callback; it is not a React hook, Svelte readable, Kefir observable, signal subscription, or throttled render path. Selector-channel helpers such as `takeLatestFromSelector` use the same `.select`/`.effect`-compatible selector read shape for Svelte `Store`, `ReactStore`, and `StreamingStore` selectors. They run in sagas, subscribe to the Redux store from saga context, and take plain selector arguments rather than Svelte readable, React `ReadonlySignal`, or Kefir `Observable` direct-call values.

### 4. Direct State Access (`.select()`)

For tests, event handlers, or composing selectors:

```typescript
import { store as appStore } from "$lib/store";

// In tests
const state = appStore.state;
const count = selectItemCount.select(state);

// In event handlers (where getContext is unavailable), use an initialized
// Store instance captured from module/component context.
function handleClick() {
  const value = selectItemCount.select(appStore.state);
}
```

### 5. Bound to a Store (`.withStore()`)

```typescript
const boundSelector = selectTodoById.withStore(store);
const todo = boundSelector(todoId); // Returns the direct-call type for that Store family
```

For `Store`, the bound result is a Svelte `Readable<R>`. For `ReactStore`, the bound result is a `ReadonlySignal<R>` and may bind either a `ReactStore`/signal-state source or a state signal. For `StreamingStore`, the bound result is a Kefir `Observable<R, any>`.

### 6. Streaming Store selectors

```typescript
import { StreamingStore } from "@augmentcode/themis/streaming-store";

export const streamStore = new StreamingStore({ todos: todosReducer });
export const selectTodoCountStream = streamStore.createSelector((state) => state.todos.collection.ids.length);

const todoCount$ = selectTodoCountStream(); // Returns Kefir Observable<number, any>
```

Streaming selectors emit their first available value promptly. Subsequent rapid Store state updates or observable selector argument updates are coalesced at the Store's configured `throttledSelectorFrequency`, and only the latest pending selector result emits at the scheduled moment.

---

## Proxy-Based Memoization

`store.createSelector` uses **proxy-based state tracking** and output caching through package internals:

1. **Tracks accessed paths** — When a selector runs, a Proxy records which state fields were accessed.
2. **Selective re-execution** — On subsequent calls, only re-runs if an accessed path's reference changed.
3. **Argument tracking** — Also re-runs when arguments change (shallow equality), and direct output reuse depends on stable argument identities for object/function arguments.
4. **Collection optimization** — Stops proxying at Collection boundaries since Collections are immutable and always change reference when modified.
5. **Output reuse** — Direct readable/signal/observable outputs are cached for the same state source + selector + arguments.

```typescript
// This selector only re-runs when:
// - state.todos.collection changes (reference equality)
// - OR the todoId argument changes (shallow equality)
export const selectTodoById = store.createSelector((state, todoId: string) => {
  return state.todos.collection.map[todoId];
});
```

### Store-Owned Update Scheduling

Selector emissions are scheduled and coalesced by the Store/selector internals so rapid Redux writes do not force unnecessary UI or stream consumer work. Svelte-readable `Store` selectors, React signal `ReactStore` selectors, and Kefir-based `StreamingStore` selectors use the configured `throttledSelectorFrequency` from the Store constructor options, defaulting to `64` FPS. Selector trace output is a separate default-off diagnostic; pass `{ traceSelectors: true }` in the same final Store options object only while diagnosing selector scheduling, and omit it or pass `false` for normal silent behavior. There is no public lock/unlock action API; model batching through ordinary action design, saga orchestration, and selectors that derive the final UI value.

Because Store-created selectors already cache accessed state paths, track arguments, reuse same-source/same-selector/same-stable-args direct outputs, and coalesce emissions, do not add extra memoization, manual cache maps, debounce/throttle wrappers, `requestAnimationFrame` schedulers, or writable/signal proxies around selector callbacks or selector calls solely for performance. Use normal selector composition with `.select(state, ...args)` inside another selector, pass primitive scalar selector arguments where possible, and tune the public Store constructor options when UI/stream coalescing needs an explicit FPS.

---

## Collection Selectors

For working with Collections, keep collection access behind Store-bound selectors and use the public collection utilities inside those selector callbacks:

```typescript
import { getItem, getItems, type Collection } from "@augmentcode/themis/utils/collections/collection-utils";
import { store } from "$lib/store";

// Get the collection itself
export const selectTodosCollection = store.createSelector(
  (state): Collection<Todo, "id"> => state.todos.collection
);

// Get a single item by ID (optimized O(1) lookup)
export const selectTodo = store.createSelector((state, id: string) => {
  return getItem(selectTodosCollection.select(state), id);
});

// Get all items as an ordered array
export const selectAllTodos = store.createSelector((state) => {
  return getItems(selectTodosCollection.select(state));
});
```

---

## Selector Lifecycle Rules

| Context | Correct Usage | Why |
|---------|---------------|-----|
| Component init (top-level `<script>`) | `const val = selectFoo()` | Returns Svelte readable. Uses `getContext()` — only valid at init. |
| React component/custom hook | `const valueSignal = selectFoo(...args)` | Preferred path; returns `ReadonlySignal<R>` for direct signal `.value` or signal-aware rendering. |
| Hook/plain-value fallback | `const value = selectFoo.useValue(...args)` | Use only when a React component/custom hook must receive plain `R` and accepting a signal is impractical. |
| Event handlers, callbacks | `selectFoo.select(appStore.state)` | Direct read from an initialized `Store` instance captured outside the handler. No Svelte context needed. |
| Sagas | `yield* selectFoo.effect()` | Uses redux-saga's `select` effect. |
| Composing selectors | `selectFoo.select(state)` | Direct read within another selector. |

**⚠️ CRITICAL for Svelte `Store`:** Never call `selectFoo()` (the readable form) inside event handlers, callbacks, or async functions — it calls `getContext()` which only works during component initialization. For React `ReactStore`, prefer direct selector signals in components/custom hooks and reserve `.useValue(...args)` for necessary plain-value fallbacks; non-component one-shot code should use `.select(state, ...args)`.

---

## Best Practices

1. **Always create named selectors** — Define selectors in `*-selectors.ts` files, never inline.
2. **Keep one selector owner per slice directory** — Pair one `*-selectors.ts` with one `*-slice.ts`; split multiple logical slices into separate directories.
3. **Compose selectors** — Reuse existing selectors via `.select()` instead of re-reading state paths.
4. **Use descriptive names** — `selectCurrentConversationId`, not `getCurrentId`.
5. **Trust Store caching** — Store-created selectors cache selector results and same-source/same-selector/same-args direct outputs; do not wrap them in extra `memoize`, manual caches, debounce/throttle, or scheduler utilities.
6. **Keep selector arguments stable** — Prefer scalar parameters over fresh object/array/function arguments; use object/function args only when the identity is stable and intentional.
7. **Return same reference when possible** — If no filtering/mapping is needed, return the state value directly.
8. **Never mutate in selectors** — Use `[...array].sort()` instead of `array.sort()`.
9. **No side effects** — No console.log, no analytics, no mutations.

---

## Anti-Patterns

### ❌ Inline Selectors in Sagas

```typescript
// BAD
const value = yield* select((state) => state.todos.items);

// GOOD
const value = yield* selectAllTodos.effect();
```

### ❌ Declaring Selectors Inside Saga Modules

Selector ownership belongs in the slice's `[slice]-selectors.ts` file. Declaring `select*` functions or factories directly inside a saga module is invalid even when they are not exported: it scatters state-shape knowledge into the saga layer, prevents reuse from components/tests, and bypasses the architecture rules that gate selector placement.

```typescript
// BAD — selector logic lives in the saga file (even though it is module-private)
// src/todos/todos-sagas.ts
const selectVisibleTodos = (state: AppState) => state.todos.visible;
const selectTodoById = (todoId: string) => (state: AppState) => state.todos.map[todoId];

function* watchVisibleTodos() {
  const visible = yield* select(selectVisibleTodos);
  const todo = yield* select(selectTodoById("first"));
}

// GOOD — selectors live in [slice]-selectors.ts; sagas import them and use .effect(...)
// src/todos/todos-selectors.ts
export const selectVisibleTodos = store.createSelector((state) => state.todos.visible);
export const selectTodoById = store.createSelector((state, todoId: string) => state.todos.map[todoId]);

// src/todos/todos-sagas.ts
import { selectVisibleTodos, selectTodoById } from "./todos-selectors";

function* watchVisibleTodosGood() {
  const visible = yield* selectVisibleTodos.effect();
  const todo = yield* selectTodoById.effect("first");
}
```

### ❌ Creating Selectors Inside Components

```typescript
// BAD — creates new selector on every render
const selector = store.createSelector((state) => state.todos.count);

// GOOD — defined at module level
export const selectTodoCount = store.createSelector((state) => state.todos.count);
```

### ❌ Adding Extra Selector Caches or Schedulers

```typescript
// BAD — Store-created selectors already cache and coalesce internally
const cachedSelectTodos = memoize(() => selectTodos());
const throttledTodos = debounce(() => selectTodos.select(appStore.state), 100);

// GOOD — call the selector through the mode appropriate for the context
const todos = selectTodos();
const snapshot = selectTodos.select(appStore.state);
```

If selector output is too chatty for UI or stream consumers, tune `throttledSelectorFrequency` on the owning Store instead of layering custom caches, timers, or scheduler wrappers around the selector.

### ❌ Calling Readable Form Outside Component Init

```typescript
import { store as appStore } from "$lib/store";

// BAD — crashes with lifecycle_outside_component
function handleClick() {
  const val = get(selectFoo());
}

// GOOD — use .select() with an initialized Store instance captured outside the handler
function handleClick() {
  const val = selectFoo.select(appStore.state);
}
```

