---
name: svelte/store
description: >-
  Store import, initialization, disposal, and Store-runtime guidance for the
  canonical Svelte-readable Store variant. Use for @augmentcode/themis/svelte-store,
  useInitStore/useRunSaga lifecycle helpers, inherited
  runSaga/dispatch/state behavior for Svelte-readable Store consumers.
type: sub-skill
requires:
  - svelte
  - core/import-boundaries
sources:
  - "@augmentcode/themis/svelte-store"
  - "@augmentcode/themis/components-svelte/use-init-store"
  - "@augmentcode/themis/components-svelte/use-run-saga"
  - "@augmentcode/themis/docs/ARCHITECTURE.md"
  - "@augmentcode/themis/README.md"
triggers:
  - Svelte Store class
  - svelte-store import
  - Svelte Store state lifecycle
  - useInitStore
  - useRunSaga
  - Svelte readable Store
---
# Store import and lifecycle

Use this skill when a task needs the canonical Svelte-readable Store variant. For shared state policy, reducers, actions, sagas, and package import boundaries, also follow the matching `core/*` skills.

This is Svelte Store family guidance for Svelte component and application code.

## Correct import and class choice

- Use `Store` from `@augmentcode/themis/svelte-store`.
- Do not import `Store` from the package root, `src/*`, or selector internals such as `utils/svelte-selectors/*`.

```ts
import { Store } from "@augmentcode/themis/svelte-store";

export const store = new Store({ todos: todosReducer });
const dispose = store.init();
```

## Lifecycle rules

- Construct `Store` with app-owned reducers and optional middleware, then call `store.init(initialState?)` before invoking direct selector calls.
- Infer state with `StoreState<typeof store>` from `@augmentcode/themis/types`; avoid an explicit `: Store` annotation that loses constructor reducer-map inference. `getReducers()` exposes the app-owned reducer map; `addMiddleware(...)` adds middleware before initialization. Custom middleware is prepended before the base chain.
- Direct selector calls return Svelte `Readable` outputs backed by the Store-owned state stream after initialization and throw before `init()` or after `dispose()`.
- If a Store runtime or context already exists in the Svelte component tree, `init()` skips setup and returns a noop disposer. Do not try to add child-layout reducers, middleware, or sagas by repeating `init()`; configure the owning Store instead.
- `init()` creates Redux/readable state and starts the package-owned saga manager, but does **not** start app sagas. Start each app saga explicitly after initialization; see **App saga lifetime** below.
- Capture the disposer returned by `init()` and register `onDestroy(dispose)` in a component owner. It is equivalent to `store.dispose()`, which stops Store-owned tasks/subscriptions, removes devtools registration, and is safe before initialization. Tests and non-component owners must also dispose their Store.
- `initDevTool()` explicitly registers an initialized Store for inspection and returns its own cleanup function; it is not part of normal bootstrap. See `../../core/debugging/SKILL.md` for diagnostics.
- Use `store.dispatch(action)` and `store.state` on the initialized Store. For async dispatch completion use `../../core/actions/SKILL.md`; for app selector creation use `../selectors/SKILL.md` → **Choose the factory**.
- Do not manually register package-owned `@internal_` reducers or internal sagas.

## App saga lifetime

- `store.runSaga(sagaFn)` derives the managed name from the function, starts the saga, and returns a per-saga cancel function. It throws before `init()` or for a reserved internal name; never start `@internal_sagaManager` yourself.
- In a component, `onMount(() => store.runSaga(sagaFn))` starts on mount and returns cancellation to Svelte for unmount. Remounting starts it again; this is not a once-per-Store-creation initializer.
- In a service or test, keep `const cancel = store.runSaga(sagaFn)` and call `cancel()` when that operation ends.
- Per-saga cancellation is distinct from whole-Store teardown. Use the cancel function for ordinary mount/operation cleanup and `store.dispose()` only when the owner ends the Store lifetime.
- Framework-neutral lifetime placement lives in `../../core/sagas/SKILL.md` → **Application saga startup**; managed startup/cancellation/disposal lives in `../../core/saga-manager/SKILL.md` → **Store saga lifecycle**. Root-layout wiring lives in `../component-integration/SKILL.md` → **Root layout wiring**.

```ts
const dispose = store.init();
const cancel = store.runSaga(editorSaga);
cancel(); // end this saga's operation
dispose(); // end the Store owner's lifetime
```

## Svelte component lifecycle helpers

- `useInitStore(store, initialState?)` from `@augmentcode/themis/components-svelte/use-init-store` calls `store.init(initialState)` and disposes via `onDestroy`. Call it at component init time, typically in the root layout.
- `useRunSaga(saga)` from `@augmentcode/themis/components-svelte/use-run-saga` starts a saga on mount and stops it on destroy. Call it at component init time after the Store is initialized.
- Import these helpers from their leaf subpaths only, not from old `components/*` paths or a `components-svelte` directory barrel.

## Svelte Store guarantees

- `Store` is the only Store class whose selector direct calls return Svelte readables for `$selector$` template reads.
- Keep selector direct calls, component initialization, and readable template
  bindings within the Svelte Store lifecycle described above.

## Verification cues

- Imports use `@augmentcode/themis/svelte-store` for `Store` and `@augmentcode/themis/components-svelte/*` leaf subpaths for lifecycle helpers.
- Svelte examples initialize the Store before readable selector reads, or tests explicitly assert the pre-init error path.
- The app path initializes the Store before direct readable selector calls.

## See also

- `../selectors/SKILL.md` — `store.createSelector`, composition, and cache contracts.
- `../selector-lifecycle/SKILL.md` — component-init, handler, and saga call modes.
- `../component-integration/SKILL.md` — root layout wiring and template reactivity.
- `../../core/import-boundaries/SKILL.md` — public package import surface.

