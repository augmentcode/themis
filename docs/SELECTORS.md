# Selectors Guide

> **How to create and use selectors with proxy-based memoization.**

---

## Table of Contents

1. [What are Selectors?](#what-are-selectors)
2. [Creating Selectors](#creating-selectors)
3. [Using Selectors](#using-selectors)
4. [Proxy-Based Memoization](#proxy-based-memoization)
5. [Selector Tracing Diagnostics](#selector-tracing-diagnostics)
6. [Redux Action Logging Diagnostics](#redux-action-logging-diagnostics)
7. [Collection Selectors](#collection-selectors)
8. [Selector Lifecycle Rules](#selector-lifecycle-rules)
9. [Best Practices](#best-practices)
10. [Anti-Patterns](#anti-patterns)

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

Svelte-readable, React signal, and StreamingStore selector emissions derive from one StoreRuntime-owned Kefir store-state property that is driven by a Store-scoped cadence source defaulting to `64` FPS. React and Svelte stores adapt that internal Kefir property to their public signal/readable interfaces, while StreamingStore exposes the Kefir observable shape directly. To tune Store-state coalescing, pass Store options as the final constructor argument. The cadence is capped by `throttledSelectorFrequency`; the value must be finite and within the inclusive `1..256` FPS range. Fractional values such as `48.5` are accepted, and invalid values throw instead of clamping.

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

Direct signal calls and `.useValue(...args)` derive from the owning `ReactStore`'s cadenced state signal and are capped by `throttledSelectorFrequency` for Store-state changes. Selector arguments may be plain values or `ReadonlySignal` values; signal arguments are read reactively by the computed selector and may update the selector result immediately. Keep `.useValue(...args)` for third-party components, legacy hook boundaries, or other places that must receive plain `R`.

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

Streaming selectors emit their first available value promptly. Subsequent rapid Store state updates are coalesced by the Store-owned state observable on cadence ticks capped by `throttledSelectorFrequency`, and only changed latest-current selector results emit from that cadenced state source. Observable selector argument updates may recompute and emit immediately when the selected result changes.

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

Selector emissions are scheduled and coalesced by a shared StoreRuntime-owned Kefir state property so rapid Redux writes do not force unnecessary UI or stream consumer work. Svelte-readable `Store` selectors, React signal `ReactStore` selectors, and Kefir-based `StreamingStore` selectors derive from that same cadenced Store state source and convert only at their public boundaries; the maximum state tick rate comes from the configured `throttledSelectorFrequency` Store constructor option, defaulting to `64` FPS. Selectors then compute from the latest cadenced state value, compare with the last emitted result where the API supports distinctness, and allow readable/signal/observable selector argument changes to update immediately when only arguments change the result. Because StoreRuntime owns that Kefir property at runtime, all Store variants require the `kefir` peer dependency to be installed. Selector trace output is a separate default-off diagnostic; pass `{ traceSelectors: true }` in the same final Store options object only while diagnosing selector scheduling, and omit it or pass `false` for normal silent behavior. There is no public lock/unlock action API; model batching through ordinary action design, saga orchestration, and selectors that derive the final UI value.

Because Store-created selectors already cache accessed state paths, track arguments, reuse same-source/same-selector/same-stable-args direct outputs, and coalesce emissions, do not add extra memoization, manual cache maps, debounce/throttle wrappers, `requestAnimationFrame` schedulers, or writable/signal proxies around selector callbacks or selector calls solely for performance. Use normal selector composition with `.select(state, ...args)` inside another selector, pass primitive scalar selector arguments where possible, and tune the public Store constructor options when UI/stream coalescing needs an explicit FPS.

### Selector Tracing Diagnostics

Selector tracing is a default-off, opt-in diagnostic available in development and production builds. Configure it in the third (options) argument of `Store`, `ReactStore`, or `StreamingStore`; pass `undefined` for middleware when there is no middleware to configure:

```typescript
import { Store } from "@augmentcode/themis/svelte-store";
import { todosReducer } from "./todos-slice";

export const store = new Store(
  { todos: todosReducer },
  undefined,
  { traceSelectors: true }
);
```

The public contract is flat: `traceSelectors` accepts `undefined`, `false`, `true`, or one object whose properties are the eleven fields below. The object is not nested and arrays or unknown properties are rejected. Omitted object fields use the defaults shown here:

| Field | Default | Controls |
| --- | --- | --- |
| `traceExecution` | `false` | Selector execution counts, recomputation counts, and duration aggregates in period rows. |
| `traceCache` | `false` | Direct readable/signal/observable output-cache request, hit, miss, and ratio metrics in period rows. |
| `traceInvalidation` | `false` | Counts for each selector invalidation reason in period rows. |
| `traceArguments` | `false` | Selector argument-computation and changed-argument counts in period rows. |
| `traceResults` | `false` | Counts for initial, changed, and retained-reference outcomes in period rows. |
| `traceCadence` | `false` | Store scheduling subscription and cadence-tick messages. |
| `minDurationMs` | `0` | Inclusive minimum period maximum duration for an execution row. |
| `minRecomputationCount` | `0` | Inclusive minimum period recomputation count for an execution row. |
| `minCacheMissCount` | `0` | Inclusive minimum period cache-miss count for a cache row. |
| `summaryEnabled` | `false` | Retains the lifetime, non-resetting `getSelectorTraceSummary()` snapshot. Period aggregates are automatic whenever tracing is enabled. |
| `summaryIntervalMs` | `1000` | Milliseconds between automatic period aggregate records whenever tracing is enabled. |

`traceSelectors: true` is the compatibility preset: it enables all six event categories with all three thresholds at `0`, automatic period aggregates, and no lifetime snapshot. `traceSelectors: false` and an omitted option disable every category and aggregate timer. In object form, each category is independent, so enabling `traceInvalidation` does not implicitly enable execution, argument, result, cache, or cadence output. The three threshold fields and `summaryIntervalMs` must be finite numbers greater than or equal to zero; the category and `summaryEnabled` fields must be booleans.

For example, this enables only invalidation and result metadata, filters execution records shorter than 2 ms, and starts one-second aggregate reporting:

```typescript
const store = new Store(
  { todos: todosReducer },
  undefined,
  {
    traceSelectors: {
      traceInvalidation: true,
      traceResults: true,
      minDurationMs: 2,
      summaryEnabled: true,
    },
  }
);
```

The same options object and defaults apply to all three Store families. `Store` direct selector calls return Svelte `Readable` values, `ReactStore` calls return Preact `ReadonlySignal` values, and `StreamingStore` calls return Kefir `Observable` values; tracing observes the same selector computation and output-cache events regardless of that public adapter. The existing selector lifecycle rules still apply: initialize the Store before direct reactive calls, and dispose the returned initializer disposer (or call `store.dispose()`) when the Store is no longer used.

#### Console aggregate records

Selector trace metadata is collected without per-call console noise. On each
non-empty interval, one `console.info` call uses the
`[themis] selector trace summary` prefix and has the exact aggregate shape
`{ intervalMs, selectors }`. Each selector row has the exact
`SelectorTracePeriodSummary` shape:

| Field | Meaning |
| --- | --- |
| `selectorSource` | Safe callback source snippet used as selector identity. |
| `executionCount` | Number of execution samples collected during this interval. |
| `recomputationCount` | Selector recomputations during this interval; this is an interval delta, not a lifetime total. |
| `invalidationReasons` | Counts for `first-execution`, `selector-arguments-changed`, `accessed-state-paths-changed`, and `previous-result-unavailable`. |
| `resultOutcomes` | Counts for `initial`, `changed`, and `retained-reference`. |
| `arguments` | `{ count, changedCount }` for argument-related computations during this interval. |
| `duration` | `{ count, totalMs, averageMs, maximumMs }` for this interval. |
| `cache` | `{ requestCount, hitCount, missCount, hitRatio }` for this interval; `hitRatio` is `null` when there are no requests. |

Rows are emitted when at least one enabled category qualifies. `minDurationMs`
and `minRecomputationCount` use inclusive comparisons against the interval's
maximum duration and recomputation count for execution eligibility.
`minCacheMissCount` uses an inclusive comparison against the interval miss count
for cache eligibility. Thresholds filter emitted rows, not collected samples;
invalidation, argument, and result categories are represented by their counts,
not individual metadata records. No accessed paths, changed-path metadata,
argument types, output-cache status, or cumulative cache counters are present in
the aggregate payload.

Cache miss styling is selector-specific: a selector label is bold when its
interval `cache.missCount` is greater than zero, while hit-only labels remain
ordinary. Cache `requestCount`, `hitCount`, and `missCount` are interval deltas.

Cadence diagnostics are separate scheduling messages: `SUBSCRIBE SELECTOR CADENCE` reports subscriber count and `SELECTOR CADENCE TICK` reports the tick timestamp and listener count. They describe Store scheduling, not selector payloads.

#### Privacy guarantee

Tracing never captures or logs selector argument values, selector results, or state
values. The aggregate payload reports only callback source identity, interval
counts, duration aggregates, cache counters, ratios, and fixed invalidation,
argument, and result labels. A `selectorSource` snippet identifies callback code;
it is not a runtime state snapshot. Internal path metadata is not included in the
period aggregate or lifetime summary.

#### Aggregate summaries

Period aggregation is automatic for every explicitly enabled selector-tracing category, including `traceSelectors: true`; it does not require `summaryEnabled`. Set `summaryEnabled: true` when you also need privacy-preserving, per-selector lifetime summaries. Read that non-resetting snapshot at any time with the inherited, read-only Store API:

```typescript
const summaries = store.getSelectorTraceSummary();
```

The result is a deep-frozen lifetime snapshot and calling it does not reset or mutate the collector. With no lifetime summary data (including `summaryEnabled: false`), it returns an empty array. Each selector entry contains:

| Field | Contents |
| --- | --- |
| `selectorSource` | Safe callback source snippet used as selector identity. |
| `executionCount` | Number of execution-duration records collected. |
| `recomputationCount` | Total selector recomputations. |
| `invalidationReasons` | Counts for all four invalidation reason labels. |
| `resultOutcomes` | Counts for `initial`, `changed`, and `retained-reference`. |
| `duration` | `count`, `totalMs`, `averageMs`, `maximumMs`, and `p95Ms`. |
| `cache` | `requestCount`, `hitCount`, `missCount`, and `hitRatio` (`null` when there are no requests). |

Duration `count`, total, average, and maximum are lifetime aggregates. The p95 calculation retains at most 64 duration samples in a bounded ring buffer, so `p95Ms` is a bounded-window percentile rather than storage of every duration. Cache, invalidation, and result aggregates likewise retain metadata only; they never retain argument, result, or state values. Period aggregate rows contain resettable interval deltas (`executionCount`, `recomputationCount`, duration metrics, invalidation/result counts, and cache request/hit/miss metrics); after each interval they reset, while the lifetime snapshot continues accumulating.

After `store.init()`, enabled tracing starts one interval using `summaryIntervalMs` and writes exactly one `[themis] selector trace summary` record for each non-empty period. Empty or idle periods are silent. Repeated `init()` calls do not create duplicate intervals. The initializer disposer and `store.dispose()` stop the interval, clear pending period data, and dispose normal selector cadence resources. Cadence subscribe and tick diagnostics remain immediate and are not aggregated.

#### Default-off and production behavior

Tracing is disabled by default in every build. For compatibility, calling the legacy `store.traceSelectors()` method on a Store constructed with omitted or `false` tracing options activates the same event preset as `traceSelectors: true`; a configured flat object remains authoritative. The option, reporter, summary collector, summary timer, console output, and category-specific tracing work are available in production when explicitly enabled. Keep the option omitted or `false` in normal builds, enable it only while diagnosing a real interaction, and remove it (or set it back to `false`) afterward.

#### Performance diagnosis workflow

1. Enable the smallest useful set of categories in a development or production build, initialize the Store, and reproduce the slow interaction through the real selector call path.
2. Filter the console for `[themis] selector trace summary`. Start with aggregate selector rows that have high period maximum duration or unexpectedly increasing recomputation counts; inspect `selectorSource` and the category counts.
3. Use invalidation, argument, and result counts to distinguish recomputation reasons, argument churn, and retained references. Compare interval cache hit/miss metrics for direct output reuse.
4. Use `getSelectorTraceSummary()` or periodic summary records to compare aggregate duration, p95, invalidation, result, and cache statistics before and after a selector change. Remove `traceSelectors` (or set it to `false`) after the investigation.

---

## Redux Action Logging Diagnostics

Redux action logging is separate from selector tracing, saga monitoring, and the
devtools inspection API. It is a default-off, construction-time diagnostic shared
by `Store`, `ReactStore`, and `StreamingStore`. Pass it in the third constructor
argument and use `undefined` for the middleware placeholder when no middleware is
configured:

```typescript
const options = { logReduxActions: true };

const svelteStore = new Store(reducers, undefined, options);
const reactStore = new ReactStore(reducers, undefined, options);
const streamingStore = new StreamingStore(reducers, undefined, options);
```

Use the constructor for the one Store family selected by the app; the three lines
above show the shared signature, not a recommendation to combine families. The
option is disabled when omitted or `false`, and there is no dev-mode, localStorage,
global debug-console, or runtime toggle. To disable it, omit the option or set it to
`false` and construct a new Store. Changing an options object, calling `init()`
again, or disposing and reusing an instance does not rebuild its middleware
pipeline.

When an enabled Store is constructed, the logger prints the one-time
`🔧 Redux Logger Active` legend. Each subsequent dispatch after initialization is
represented by one `console.groupCollapsed` group:

1. The group title is the action type, with a primitive `payload` (or a one-element
   primitive payload array) appended inline. Complex payloads are intentionally not
   copied into the title.
2. Expand the blue `action` record to inspect the dispatched action. CSS style
   arguments are presentation only, not additional action fields.
3. For a changed state, expand the green `state` record and its lazy `changes`
   property. `changes` is keyed by state path, and each entry contains `prev` and
   `next`; the diff is computed when the console property is inspected.
4. For an unchanged state, the gray `state (no changes)` record contains
   `{ state: nextState }`. This means the reducer returned the same state
   reference; it is not a logger failure or a rejected action.

The logger's diff can contain application state values. Redact secrets, tokens,
personal data, and other sensitive values before copying a group into an issue or
diagnostic report. Do not use Redux action groups to infer selector performance:
selector tracing emits one privacy-safe `[themis] selector trace summary` aggregate
per non-empty interval, while Redux logging emits one grouped record per dispatch.

For a dispatch investigation, enable the logger on a focused Store instance,
initialize it, reproduce the real action, expand only the relevant lazy diff paths,
redact any captured values, and dispose the Store afterward. For selector
investigations, use the [Selector Tracing Diagnostics](#selector-tracing-diagnostics)
workflow and disable tracing on the next Store construction.

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

If selector output is too chatty for UI or stream consumers, tune the owning Store's `throttledSelectorFrequency` cadence cap instead of layering custom caches, timers, or scheduler wrappers around the selector.

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

