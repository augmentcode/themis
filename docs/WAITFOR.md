# waitFor Saga Utility Guide

> Wait for a selector to reach an expected value before continuing.

## Table of Contents

1. [Overview](#overview)
2. [Function Signature](#function-signature)
3. [How It Works](#how-it-works)
4. [Usage Examples](#usage-examples)
5. [Rules and Best Practices](#rules-and-best-practices)
6. [Related Utilities](#related-utilities)

## Overview

`waitFor` is a saga utility that pauses execution until a selector's value matches an expected condition. It's useful for coordinating async operations that depend on state changes — for example, waiting for data to finish loading before proceeding.

**Import:** `import { waitFor } from "@augmentcode/themis/saga"` (the public `@augmentcode/themis/saga` subpackage; the internal implementation lives in `src/slices/store-utility/sagas/waitFor.ts` and must not be imported directly)

## Function Signature

```typescript
function* waitFor<ARGS extends any[], R>(
  selector: StoreSelector<R, ARGS>,
  args: ARGS,
  isExpectedValue: (value: R, prevVal: R | undefined | null) => boolean,
  timeoutMs?: number
): Generator<any, boolean, any>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| selector | StoreSelector<R, ARGS> | A named selector; for production app-local selectors, create it with `store.createSelector(...)` |
| args | ARGS | Stable arguments to pass to the selector (use [] for no-arg selectors) |
| isExpectedValue | (value: R, prevVal: R | undefined | null) => boolean | Predicate that returns true when the condition is met |
| timeoutMs | number (optional) | Maximum wait time in milliseconds |

### Return Value

- Returns `true` when the expected condition is met
- Returns `false` if `timeoutMs` is provided and the timeout elapses first
- Without `timeoutMs`, waits indefinitely until the condition is met

## How It Works

1. **Immediate check** — Reads the selector's current value. If it already matches, returns `true` immediately.
2. **Channel subscription** — If the value doesn't match, creates a channel to listen for state changes via `createChannelFromSelector`.
3. **Value monitoring** — Each time the selector emits a new value, checks the predicate.
4. **Timeout race** — If `timeoutMs` is provided, races between value match and a `delay(timeoutMs)`.
5. **Cleanup** — Always closes the channel in a `finally` block to prevent memory leaks.

```
waitFor(selector, args, predicate, timeout?)
  │
  ├─ Read current value via selector.effect()
  │   └─ If predicate(value) → return true (immediate)
  │
  ├─ Create channel from selector
  │
  ├─ If timeout provided:
  │   └─ race({ value: checkChannel, timeout: delay(ms) })
  │       ├─ value wins  → return true
  │       └─ timeout wins → return false
  │
  └─ If no timeout:
      └─ Wait on channel until predicate matches → return true
```

## Usage Examples

### Basic: Wait for a Boolean Flag

```typescript
import { waitFor } from "@augmentcode/themis/saga";

function* mySaga() {
  // Wait for loading to complete
  yield* waitFor(
    selectIsLoading,
    [],
    (isLoading) => isLoading === false
  );

  // Continue after loading is done
  yield* put(doNextStep());
}
```

### With Selector Arguments

```typescript
function* processItem(itemId: string) {
  // Wait for a specific item's status
  yield* waitFor(
    selectItemStatus,
    [itemId],
    (status) => status === "ready"
  );

  yield* put(startProcessing(itemId));
}
```

Use the same selector argument stability policy as `.effect(...)` and selector
channels: prefer primitive scalar args in the tuple, and avoid fresh object,
array, or function literals. Object/function args are valid only when the
selector intentionally keys by a stable reference, such as a memoized config or
existing source object.

### Using Previous Value

The predicate receives both the current and previous value, enabling change detection:

```typescript
function* detectChange() {
  // Wait for value to change from its current state
  yield* waitFor(
    selectStatus,
    [],
    (value, prevVal) => {
      return prevVal !== undefined && value !== prevVal;
    }
  );

  yield* put(statusChanged());
}
```

### Complex Condition

```typescript
function* waitForCompletion(taskId: string) {
  yield* waitFor(
    selectTaskPhase,
    [taskId],
    (phase) => phase === "completed" || phase === "error"
  );
}
```

## Rules and Best Practices

### ✅ DO

1. **Always use named selectors** — Pass named selectors; for production app-local selectors, create them with `store.createSelector(...)`, never inline lambdas.
2. **Keep **`isExpectedValue`** pure** — No side effects, no API calls, no mutations.
3. **Add timeouts for production code** — Prevent indefinite waits.
4. **Handle the timeout case** — When using `timeoutMs`, always check the return value.
5. **Use empty array for no-arg selectors** — `waitFor(selectFoo, [], predicate)`.
6. **Keep selector args stable** — Prefer scalar args; pass object/function args only when their identity is stable and intentional.

### ❌ DON'T

1. **Don't use inline selectors** — `waitFor((state) => state.foo, ...)` is not supported.
2. **Don't perform side effects in the predicate** — Keep `isExpectedValue` pure.
3. **Don't wait indefinitely in production** — Always consider a reasonable timeout.
4. **Don't use for polling** — Use `takeLatestFromSelector` or channels for continuous monitoring.
5. **Don't ignore the return value when using timeouts** — A `false` return means the condition was not met.

## Related Utilities

| Utility | Purpose |
| --- | --- |
| createChannelFromSelector | Create a channel from a selector for custom patterns |
| takeLatestFromSelector | Watch selector changes continuously (cancel previous) |
| takeEveryFromSelector | Watch selector changes continuously (handle all) |
| delay | Simple time-based delays without state monitoring |

→ See [SAGAS.md](./SAGAS.md) for channel and selector effect patterns.