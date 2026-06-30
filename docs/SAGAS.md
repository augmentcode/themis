# Sagas Guide

> Side effect management with redux-saga generators.

## Table of Contents

1. [What are Sagas?](#what-are-sagas)
2. [Core Effects](#core-effects)
3. [Saga Patterns](#saga-patterns)
4. [Selector Channel Effects](#selector-channel-effects)
5. [Debounce Saga](#debounce-saga)
6. [Retry and Timeout Helpers](#retry-and-timeout-helpers)
7. [Async Generator Streams](#async-generator-streams)
8. [Saga Manager (Auto-Restart)](#saga-manager)
9. [Saga Monitoring (Optional)](#saga-monitoring-optional)
10. [Error Handling](#error-handling)
11. [Rules and Best Practices](#rules-and-best-practices)

## What are Sagas?

Sagas are long-running generator functions that handle side effects: API calls, persistence, timers, event listeners, and complex async workflows. They listen for actions and can dispatch new actions.

This package uses `typed-redux-saga` for type-safe saga effects.

**Why sagas?**

- Keep reducers pure — no side effects in state transitions
- Declarative effects — easy to test and reason about
- Cancellation support — `takeLatest` automatically cancels previous runs
- Complex orchestration — coordinate multi-step workflows

## Core Effects

All effects are imported from `typed-redux-saga`:

```typescript
import { call, put, select, take, takeEvery, takeLatest,
         fork, delay, race, all } from "typed-redux-saga";
```

### `takeEvery` — Handle Every Action

Spawns a new task for **each** matching action:

```typescript
yield* takeEvery(fetchItems, function* (action) {
  const items = yield* call(api.fetchItems, action.payload[0]);
  yield* put(setItems(items));
});
```

### `takeLatest` — Cancel Previous, Handle Latest

Cancels any previous running task when a new action arrives:

```typescript
yield* takeLatest(searchQuery, function* (action) {
  yield* delay(300); // Natural debounce
  const results = yield* call(api.search, action.payload[0]);
  yield* put(setResults(results));
});
```

### `call` — Call a Function

Calls a function and waits for its return value:

```typescript
const result = yield* call(myFunction, arg1, arg2);
const data = yield* call([obj, obj.method], arg1); // Method call
```

### `put` — Dispatch an Action

```typescript
yield* put(setItems(items));
```

### `select` — Read State

```typescript
// Use named selectors with .effect()
const count = yield* selectItemCount.effect();
const item = yield* selectItemById.effect(itemId);
```

### `take` — Wait for a Specific Action

```typescript
const action = yield* take(submitForm);
// Execution pauses until submitForm is dispatched
```

### `fork` — Non-Blocking Task

```typescript
const task = yield* fork(backgroundWorker);
// Continues immediately; task runs in background
```

Use attached `fork` for child work in this package. Do not introduce detached `spawn`; attached children are cancelled when their parent saga fails or is cancelled.

### `delay` — Wait for Time

```typescript
yield* delay(1000); // Wait 1 second
```

### `race` — First to Finish Wins

```typescript
const { response, timeout } = yield* race({
  response: call(api.fetchData),
  timeout: delay(5000),
});
if (timeout) {
  yield* put(fetchTimedOut());
}
```

### `all` — Run in Parallel

```typescript
const [users, posts] = yield* all([
  call(api.fetchUsers),
  call(api.fetchPosts),
]);
```

**Note:** Action creators can be passed directly to `takeEvery`, `takeLatest`, `takeLeading`, and `take`. No need for `.type`.

## Saga Patterns

### Polling

```typescript
function* pollData() {
  while (true) {
    yield* put(fetchData());
    yield* delay(5000);
  }
}
```

### Multi-Step Workflow

```typescript
function* wizard() {
  yield* takeEvery(startWizard, function* () {
    yield* put(showStep1());
    yield* take(step1Complete);
    yield* put(showStep2());
    yield* take(step2Complete);
    yield* put(wizardDone());
  });
}
```

### Debounce with takeLatest

```typescript
function* debounceSearch() {
  yield* takeLatest(searchInput, function* (action) {
    yield* delay(300);
    const results = yield* call(api.search, action.payload[0]);
    yield* put(setResults(results));
  });
}
```

## Selector Channel Effects

React to **selector value changes** in sagas. These handle channel lifecycle automatically.

**Public API:** `@augmentcode/themis/saga`

### `takeLatestFromSelector` — Most Common

Cancel previous worker when a new value arrives:

```typescript
import { takeLatestFromSelector } from "@augmentcode/themis/saga";

function* watchCurrentItem() {
  yield* takeLatestFromSelector(selectCurrentItemId, function* ({ payload, prevPayload }) {
    if (payload) {
      yield* put(loadItemData(payload));
    }
  });
}
```

### `takeEveryFromSelector` — Spawn for Each Change

```typescript
import { takeEveryFromSelector } from "@augmentcode/themis/saga";

function* watchAllChanges() {
  yield* takeEveryFromSelector(selectSomeValue, function* ({ payload }) {
    yield* call(handleChange, payload);
  });
}
```

### `takeLeadingFromSelector` — Ignore While Running

```typescript
import { takeLeadingFromSelector } from "@augmentcode/themis/saga";

function* watchWithThrottle() {
  yield* takeLeadingFromSelector(selectSomeValue, function* ({ payload }) {
    yield* call(expensiveOperation, payload);
  });
}
```

### With Selector Arguments

Pass arguments as the second parameter:

```typescript
yield* takeLatestFromSelector(selectItemById, [itemId], function* ({ payload }) {
  // Reacts when the specific item changes
});
```

### `createChannelFromSelector` — Complex Patterns

For patterns that don't fit `takeEvery`/`takeLatest`/`takeLeading` (e.g., races, conditional loops):

Selector channels subscribe through the actual Redux store in saga context, using
`getState()` for reads and `subscribe()` for change notifications. They do not
require or receive a Svelte readable state wrapper from saga context.

```typescript
import { createChannelFromSelector } from "@augmentcode/themis/saga";

function* complexWatcher() {
  const channel = yield* createChannelFromSelector(mySelector);

  // Always use try/finally to ensure channel cleanup
  try {
    while (true) {
      const { payload, prevPayload } = yield* take(channel);
      // Complex logic...
    }
  } finally {
    channel.close();
  }
}

// With arguments
function* watchSpecificItem(itemId: string) {
  const channel = yield* createChannelFromSelector(selectItemById, itemId);
  try {
    const { channelEvent, cancelled } = yield* race({
      channelEvent: take(channel),
      cancelled: take(cancelAction),
    });
    // ...
  } finally {
    channel.close();
  }
}
```

**⚠️ Always close channels in **`finally`** blocks** to prevent memory leaks.

## Debounce Patterns

For new code, debounce the real action directly with `takeLatest` plus `delay` inside the worker. This keeps cancellation visible: each new action cancels the previous delayed worker before it runs stale side effects.

```typescript
import { call, delay, put, takeLatest } from "typed-redux-saga";

export function* searchSaga() {
  yield* takeLatest(searchInputChanged, function* searchAfterSettled(action) {
    yield* delay(300);
    const results = yield* call(api.search, action.payload[0]);
    yield* put(searchResultsLoaded(results));
  });
}
```

Use `takeLeading` plus a trailing `delay` only when the first action should run immediately and newer actions should be ignored for a window:

```typescript
import { call, delay, takeLeading } from "typed-redux-saga";

export function* refreshSaga() {
  yield* takeLeading(refreshRequested, function* refreshOncePerWindow(action) {
    try {
      yield* call(api.refresh, action.payload[0]);
    } finally {
      yield* delay(250);
    }
  });
}
```

Do not create wrapper debounce actions or use `debounceSaga`/`debounceWithKeySaga` for new work. Those exports remain available only for compatibility with existing wrapper-action flows.

## Retry and Timeout Helpers

Use `retryWithTimeout` when a saga operation may fail transiently but should not retry forever. It retries the provided saga function up to `maxRetries`, races all attempts against one overall timeout, and returns an explicit outcome string.

```typescript
import { call, put } from "typed-redux-saga";
import { retryWithTimeout } from "@augmentcode/themis/saga";

function* syncRemoteState() {
  const outcome = yield* retryWithTimeout(
    function* () {
      yield* call(api.syncRemoteState);
    },
    { maxRetries: 2, timeoutMs: 30_000, getDelayMs: (attempt) => 500 * (attempt + 1) }
  );

  if (outcome !== "success") {
    yield* put(syncFailed(outcome));
  }
}
```

Outcomes are `"success"`, `"retries-exhausted"`, and `"timeout"`. Keep the retried function idempotent because each retry starts it from scratch.

## Async Generator Streams

Use `wrapStreamingGenerator` to consume an `AsyncGenerator` from saga code. It forwards yielded chunks, forwards a non-null final return value, supports an optional timeout, and rethrows stream errors after calling an optional package-local `onError` callback. It intentionally has no Sentry or Electron dependency.

```typescript
import { put } from "typed-redux-saga";
import { wrapStreamingGenerator } from "@augmentcode/themis/saga";

function* consumeStream(stream: AsyncGenerator<MessageChunk, void, unknown>) {
  yield* wrapStreamingGenerator(
    stream,
    function* (chunk) {
      yield* put(messageChunkReceived(chunk));
    },
    { timeoutMs: 30_000, onError: (error) => reportStreamError(error) }
  );
}
```

## Saga Manager

The package saga manager (`src/slices/saga-manager/sagas/manager.ts`) provides automatic crash recovery for app-owned sagas. Start app sagas explicitly with `store.runSaga(sagaFn)` after `store.init()`; `Store` starts the internal manager during initialization and derives manager names from saga functions when they are started.

### Auto-Restart with Exponential Backoff

When a saga throws an unhandled error, the manager:

1. Catches the error and logs it
2. Records the crash in the saga's in-memory status record and dispatches a serialized crash report for Redux state
3. Waits with exponential backoff: 1s → 2s → 4s → 8s → ... (max 10 minutes)
4. Restarts the saga automatically
5. If the saga stabilizes (runs for >1 minute without crashing), the restart counter gradually decreases

### Reference Counting

Multiple overlapping `store.runSaga(sagaFn)` calls for the same derived saga name and function share the saga. The saga only stops when **every** returned cancel function has been invoked. This prevents accidental saga stops when components remount during navigation.

Full Store teardown is broader than a per-saga cancel: `store.dispose()` and the disposer returned by `store.init()` tear down the initialized Store runtime and stop saga tasks owned by that Store. Use the `store.runSaga(sagaFn)` cancel function for normal mount- or operation-scoped saga lifetimes; reserve `store.dispose()` for ending the whole Store lifetime.

### Crash Status

Saga crash history is tracked internally by the package-owned manager so crashed sagas can restart with backoff. The raw manager status record types are internal implementation details and are not part of the public package API.

The package also stores serializable crash reports in its internal saga-manager reducer, keyed by saga name. Each report contains a primitive timestamp and a plain error object so the data can be safely kept in Redux state or app-level state persistence:

```typescript
type SagaCrashReports = {
  reports: Array<{
    crashedAtTs: number;
    error: { name: string; message: string; stack?: string };
  }>;
  omittedCount: number;
};
```

Crash persistence is driven by package-owned actions:

- `addCrash(sagaName, report)` appends the serialized report only to that saga name's entry.
- Each saga keeps the newest 100 visible reports. When adding a crash would exceed the cap, older reports are trimmed and `omittedCount` increases by the number trimmed.
- `clearCrashes(sagaName)` removes that saga name's crash entry. Clearing one saga does not affect reports stored for other saga names.

These actions and the reducer state path are package internals unless they are intentionally exported through a public entrypoint in a future release. App code should not import internal saga-manager files or depend on the reserved internal state shape; use documented public Store and saga APIs for application lifecycle behavior.

## Saga Monitoring (Optional)

Saga monitoring is disabled by default. To observe redux-saga effects with the Store-owned monitor, pass `{ sagaMonitor: true }` through the same third Store constructor options object used for selector scheduling:

```typescript
import { Store } from "@augmentcode/themis/svelte-store";
import { counterReducer } from "./counter-slice";

export const store = new Store(
  { counter: counterReducer },
  undefined,
  { throttledSelectorFrequency: 64, sagaMonitor: true }
);
```

`ReactStore` and `StreamingStore` use the same final `options` argument. Omit `sagaMonitor` or pass `sagaMonitor: false` when monitoring is not needed; the Store still owns saga middleware creation, saga-manager startup, and `store.runSaga(...)` lifecycle behavior. Do not pass custom monitor objects through Store options, globally monkey-patch redux-saga, or replace the Store-owned saga middleware just to attach monitoring.

## Error Handling

### In Saga Workers

Wrap individual workers in try/catch:

```typescript
function* handleFetchItems(action: ReturnType<typeof fetchItems>) {
  try {
    const items = yield* call(api.fetchItems, action.payload[0]);
    yield* put(fetchItems.success({ items }));
  } catch (error) {
    yield* put(fetchItems.failure(error instanceof Error ? error : new Error(String(error))));
  }
}
```

### Async Action Error Flow

With `createAsyncAction`, use `.success` and `.failure` sub-actions:

```typescript
export function* mySaga() {
  yield* takeEvery(fetchItems, function* (action) {
    try {
      const result = yield* call(api.fetch, action.payload[0]);
      yield* put(action.success(result));
    } catch (e) {
      yield* put(action.failure(e instanceof Error ? e : new Error(String(e))));
    }
  });
}
```

### Channel Cleanup

Always close channels in `finally` blocks:

```typescript
function* watchChannel() {
  const channel = yield* createChannelFromSelector(mySelector);
  try {
    // ... use channel
  } finally {
    channel.close(); // Prevents memory leaks
  }
}
```

## Rules and Best Practices

1. **Always use named selectors** — Never use `yield* select((state) => ...)` inline lambdas. Create a selector and use `.effect()`.
2. **Pass action creators directly** — `yield* takeEvery(myAction, handler)`, not `takeEvery(myAction.type, handler)`.
3. **Keep workers focused** — One concern per worker function. Compose by forking multiple watchers from a root saga; do not use detached `spawn` for package-owned saga work.
4. **Use **`takeLatest`** for user-triggered actions and debounce** — Add `delay(ms)` inside the worker when input should settle before side effects run.
5. **Use **`call()`** for testability** — Wrap function calls in `yield* call(fn, args)` so they can be mocked in tests.
6. **Start sagas explicitly by function** — `store.init()` does not auto-start app sagas. Call `store.runSaga(sagaFn)` from the configured Store instance. In layouts/components, call it from `onMount` and return the cancel function for mount-scoped cleanup.
7. **Selectors live in `[slice]-selectors.ts`** — Saga modules import named `select*` selectors from the owning slice's selectors file. Declaring `select*` functions or factories locally inside a saga module is invalid even when they are not exported, because it puts state-shape knowledge in the wrong layer and bypasses the architecture rules that gate selector ownership.

   ```typescript
   // ❌ BAD — selector logic lives in the saga file
   const selectVisibleTodos = (state: AppState) => state.todos.visible;
   const selectTodoById = (todoId: string) => (state: AppState) => state.todos.map[todoId];

   function* watchVisibleTodos() {
     const visible = yield* select(selectVisibleTodos);
     const todo = yield* select(selectTodoById("first"));
   }

   // ✅ GOOD — import named selectors from the slice's selectors file and use .effect(...)
   import { selectVisibleTodos, selectTodoById } from "./todos-selectors";

   function* watchVisibleTodosGood() {
     const visible = yield* selectVisibleTodos.effect();
     const todo = yield* selectTodoById.effect("first");
   }
   ```

8. **Never `take('*')` or other wildcard takes** — Wildcard takes subscribe to every dispatched action and wake the saga on each one. They are especially harmful during streaming flows where chunk actions fire continuously, because the wildcard worker competes with the intended work and amplifies scheduler load. Use concrete action creators (or arrays of action creators), or a selector-channel helper when the trigger is a state change.

   ```typescript
   // ❌ BAD — wakes the saga on every action, including streaming chunks
   function* watchAnything() {
     while (true) {
       const action = yield* take("*");
       yield* call(audit, action);
     }
   }

   // ✅ GOOD — take the concrete trigger actions
   function* watchUserEvents() {
     yield* takeEvery([userLoggedIn, userLoggedOut], auditUserEventWorker);
   }

   // ✅ GOOD — react to a selector value change instead of every action
   function* watchReady() {
     yield* takeLatestFromSelector(selectIsReady, function* ({ payload }) {
       if (payload) yield* call(syncReadyState);
     });
   }
   ```

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "$lib/store";

  onMount(() => store.runSaga(todosSaga));
</script>
```

```ts
// Imperative — returns a cancel function that stops the saga.
const cancel = store.runSaga(todosSaga);
cancel();
```
