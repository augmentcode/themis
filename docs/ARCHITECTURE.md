# Architecture Guide

> Overview of the themis architecture: store shape, data flow, middleware, and saga lifecycle.

## Maintainer Architecture Validation

This section summarizes the architecture checks maintainers should use when reviewing changes that affect Redux state, slices, selectors, sagas, or docs that describe those patterns. Agent-only preflight and routing rules live in `skills/**/SKILL.md`; this guide focuses on the human-facing review criteria and the local commands maintainers can run to confirm them.

Run `npm run validate:architecture` before accepting or releasing a change that touches Redux state shapes, action creators, selector implementations, saga watchers/registrations, or the skills/docs that define those patterns.

Passing output is exit code 0 with `[architecture-validation] no architecture gate violations found` and a scanned source-file count; test-pattern gates also report the scanned test-file count when test files are present. `npm run validate:release` runs this gate first, so release validation cannot pass while architecture violations remain.

The package CLI no longer exposes a `validate-architecture` command (breaking change for consumers that used it). Consumer apps get architecture checking by importing one of the exported ESLint domain root configs from `@augmentcode/themis/eslint-plugins` and running ESLint against app code. Use the `npm run ...` commands in this section only inside this repository's maintainer workflow.

The ESLint migration framework lives in `eslint-plugins/`. Parent projects use the static named root configs and `plugins` per-rule config map exported from `@augmentcode/themis/eslint-plugins`. Retained standalone rule plugin subpaths under `@augmentcode/themis/eslint-plugins/plugins` remain lower-level package surfaces for selected-rule composition and validator internals, but the root entrypoint exposes no raw plugin object, helper builders, compatibility aliases, or customization APIs. The older `@augmentcode/themis/eslint-architecture` subpaths are removed; use `/eslint-plugins` only for package ESLint imports. Maintainer commands remain compatible: `npm run validate:architecture` runs the repo-local architecture validator, and `npm run validate:release` runs architecture before build/pack/import checks. The resource-heavy `eslint-plugins/*.test.mjs` rule suites have been removed; use lightweight package/API validation plus direct `eslint-plugins/index.mjs` import/config smoke checks when editing local ESLint rules or fixtures. Cross-file aggregate checks such as duplicate action type strings, selector exports/implementations, saga names, and saga registrations run in the ESLint-backed architecture validator runner. The ESLint framework tests, docs, and fixtures are dev-only and are intentionally excluded from package contents; the architecture validator script (`scripts/validate-architecture.mjs`) is also dev-only and unpacked, while the `eslint-plugins/` rule runtime remains packed for consumer ESLint configs.

Consumer `eslint.config.js` files should import exactly one composed domain root config for each app path:

```js
import { svelte } from "@augmentcode/themis/eslint-plugins";

export default svelte;
```

The root exports five composed domain configs — `core` (package/source hygiene for any JS/TS package), `store` (core + store, for state/saga packages without UI), `svelte` (core + store + svelte), `react` (core + store + react), and `streaming` (core + store, for Node/server/worker consumers) — plus `plugins` as the named per-rule config map. The former `full`/`recommended` roots are removed; previous `recommended`/`full` consumers should switch to `svelte` or their domain root. The root configs register one shared `themis` plugin namespace, list excluded rules as `off`, and enable selected `themis/<rule-id>` custom gates at warning severity. Projects that need to customize files or severities should extend or map the imported flat-config array in their own ESLint config rather than calling package helpers.

Maintainer review notes for those changes should record:

- the applicable architecture references consulted, especially `core/state-integrity` and domain leaf skills when relevant;
- the `npm run validate:architecture` results, plus any targeted searches used to rule out duplicate owners;
- the canonical Redux state owner and why no field stores derived or duplicated data;
- the canonical owner for each new action, selector, saga watcher, or saga registration, or a statement that no new owner was added;
- rule-specific ESLint disable comments and their migration, compatibility, or external-data reasons;
- final validation evidence: focused architecture tests when gate logic changes, `npm run validate:architecture`, `npm test`, `npm run build`, `npm run validate:release`, `git diff --check`, `git diff --cached --check` when staged changes exist, and `git status --short`.

The modular gate reinforces these hard rules: Redux state stores canonical, serializable facts only (no derived fields, duplicated entity copies, parallel arrays/maps, reducer-maintained selector outputs, object arrays where `Collection<T, K>` belongs, runtime `Date`/`Map`/`Set`/`Error` values, or nondeterministic reducer-created state); action type strings must be namespaced and uniquely owned; RTK APIs and new shared `*.store.svelte.ts` stores are blocked; selector exports/bodies, saga function names, and saga registration names must not be duplicated; each slice directory owns exactly one `*-slice.ts` and one `*-selectors.ts` module; logical slice identity names in reducer-map keys and action namespaces are camelCase; components must not import saga/reducer internals or acquire Redux dispatch/store from lifecycle callbacks; collection internals must be mutated only by collection utilities; direct localStorage access must stay in the safe helper layer; reducer handlers must remain synchronous and side-effect free; saga watchers pass action creators rather than `.type`; sagas read state through named `selectFoo.effect()` selectors rather than inline lambdas; selectors are called through the appropriate `.select()`/readable mode without extra memoization, manual caches, debounce/throttle, or scheduler wrappers; typed-redux-saga effects use `yield*`; raw channels have detectable cleanup; selector/state/action files follow low-noise naming conventions; high-signal saga test mocks include tuple-call guards; and pass-through wrappers/re-exports require documented compatibility and sunset/removal reasons.

Current ESLint fixture coverage intentionally stops at conservative, mechanically verifiable checks:

- **G9 selector call modes** — flag direct selector calls in unsafe contexts and inline `waitFor((state) => ...)` selectors; named selectors and explicit `.select(state)` evidence are acceptable.
- **G10 typed-redux-saga effect style** — flag bare `yield` for typed saga effects where `yield*` is required.
- **G11 channel lifecycle** — flag `fork()` wrapping of auto-forking channel helpers and raw channel creation without detectable cleanup.
- **G14 file structure/naming** — flag mechanically clear state type, selector export/file, one slice/selectors owner per directory, camelCase logical slice identity, redundant selector caching, and nested action type naming violations.
- **G15 high-signal test patterns** — flag selector tests that bypass `.select` and typed-redux-saga `call` mocks missing the `Array.isArray` tuple guard.

Do not turn broad migration completeness, semantic test adequacy, or lifecycle intent judgments into CI-only rules without explicit approval. Those remain maintainer-led review checks that cite searches, diffs, and reviewer reasoning.

If the gate reports a false positive or an intentional temporary exception, do not ignore it silently. Prefer fixing the model or reusing the canonical owner. Only when the exception is intentional, add a standard ESLint disable comment that names the specific architecture rule and includes a reason:

```typescript
// eslint-disable-next-line themis/duplicate-action-type -- compatibility alias until old consumers migrate
export const appendTodo = createAction("todos/add");

/* eslint-disable themis/suspicious-state-field -- persisted API snapshot, not local derivation */
```

The disable should name a specific `themis/<rule-id>` rather than broadly disabling all rules for the next line/file. Maintainers must inspect the reason and reject broad or permanent exceptions that are not tied to a migration, compatibility, or external-data constraint. Known tool diagnostics are non-blocking only when the required command exits 0 and the maintainer review notes name them; unrelated `pnpm-lock.yaml` changes remain out of scope unless dependency/package-manager work was approved.

## Table of Contents

1. [Maintainer Architecture Validation](#maintainer-architecture-validation)
2. [Core Principles](#core-principles)
3. [Data Flow](#data-flow)
4. [Store Shape](#store-shape)
5. [Middleware Pipeline](#middleware-pipeline)
6. [Saga Lifecycle](#saga-lifecycle)
7. [Key Concepts](#key-concepts)

## Core Principles

- **Single source of truth** — All shared application state lives in a single Redux store.
- **State is read-only** — State is never mutated directly; changes happen only through dispatching actions.
- **Reducers are pure functions** — Given the same state and action, a reducer always produces the same result. No side effects, no async.
- **Side effects live in sagas** — API calls, persistence, timers, event listeners, and async workflows are handled by redux-saga generators.
- **Selectors derive data** — Components read state through selectors, which provide automatic memoization via proxy-based tracking.
- **Utilities are reused before added** — Before creating a helper or wrapper, search existing package/application utilities and document whether the implementation reuses, extends, or introduces code.

### Utility Reuse Discovery Protocol

Before adding any helper, wrapper, or shared utility:

1. Search `src/utils/`, `src/slices/**`, relevant `docs/`, `skills/`, and app-local utility folders for existing behavior. Search by both likely names and behavior terms.
2. Prefer an existing documented utility. Extend it only when the change preserves its current contract and tests.
3. Add new helper code only when reuse or extension does not cover the behavior; keep new helpers domain-local until multiple domains need them.
4. Record the reuse decision in the change summary or PR notes: what was searched, what was reused or extended, or why new code was necessary.

## Data Flow

```
┌───────────────────────────────────────────────────────────┐
│                     Svelte Component                      │
│                                                           │
│   dispatch(action)                 $selectorValue         │
│        │                                ▲                 │
│        ▼                                │                 │
│   ┌─────────┐    ┌──────────┐    ┌────────────┐          │
│   │ Action  │───▶│ Reducer  │───▶│  Selector  │          │
│   └─────────┘    └──────────┘    └────────────┘          │
│        │              │                ▲                  │
│        │              ▼                │                  │
│        │         ┌─────────┐           │                  │
│        │         │  State  │───────────┘                  │
│        │         └─────────┘                              │
│        │                                                  │
│        ▼                                                  │
│   ┌─────────┐                                             │
│   │  Saga   │──── side effects (API, storage, IPC) ────▶  │
│   └─────────┘                                             │
└───────────────────────────────────────────────────────────┘
```

**Step-by-step:**

1. **Component dispatches an action** — A user interaction or lifecycle event triggers `dispatch(myAction(payload))`.
2. **Middleware processes the action** — The action passes through registered middleware for async action handling and saga scheduling.
3. **Reducer produces new state** — The appropriate reducer handles the action and returns a new immutable state object.
4. **Selectors recompute** — Selectors that track the changed state paths re-run and produce updated derived values.
5. **Consumers update** — Svelte readables, React signals/`.useValue(...)`, or Kefir streams backed by selectors notify the selected Store variant's consumers.
6. **Sagas react to actions** — Long-running saga generators listening for specific action types execute side effects and may dispatch further actions.

## Store Shape

The store state is a flat record of slice states. Infer the consumer-facing state type from the configured `Store`, `ReactStore`, or `StreamingStore` instance:

```typescript
import { Store } from '@augmentcode/themis/svelte-store';
import type { StoreState } from '@augmentcode/themis/types';

export const store = new Store({
  todos: todosReducer,
  counter: counterReducer,
});
export type AppState = StoreState<typeof store>;
```

Each app slice owns its own state type, so `AppState['todos']` comes from `todosReducer` and `AppState['counter']` comes from `counterReducer`. The concrete Store constructor reducer map drives `StoreState<typeof store>` inference without an explicit class annotation or mutating registration calls. Package-owned internal reducers are included automatically by each public Store variant, and their reserved `@internal_` domains may appear in the inferred type. Application code should not add reducers with that prefix or depend on those state shapes directly.

### Refactor Cleanup Guard

After moving, renaming, or splitting a module, inspect every old import path that the change leaves behind. The old file must not become a thin pass-through wrapper that only re-exports the new module, imports then exports the same symbols, or forwards every call to the new implementation.

Choose one of these outcomes before accepting the refactor:

- **Remove the old module** and update imports to the new path.
- **Inline the remaining behavior** into the new owner if the old file only existed as temporary glue.
- **Keep a compatibility shim only when required**, with an adjacent comment documenting the compatibility reason and the sunset/removal condition.

Maintainer refactor checklist: enumerate the old paths from the diff, search for remaining imports of those paths, and report either “no pass-through wrappers” or the documented compatibility shims that remain.

### Slice File Structure

```
src/slices/<domain>/
├── <domain>-slice.ts          # The only action/reducer owner module for this slice
├── <domain>-selectors.ts      # The only selector owner module for this slice
├── <domain>-slice.test.ts     # Reducer tests
└── sagas/
    ├── <domain>-saga.ts       # Saga logic
    └── <domain>-saga.test.ts  # Saga tests
```

Each slice directory owns exactly one `*-slice.ts` module and exactly one `*-selectors.ts` module. Split multiple logical slices into multiple directories named after their owners instead of placing several slice or selectors files side by side. Directory and file names may remain kebab-case, but logical slice identity names are camelCase: reducer maps use keys such as `userPreferences`, and action type namespaces use `"userPreferences/updateTheme"` rather than `"user-preferences/updateTheme"` or `"user_preferences/updateTheme"`.

## Middleware Pipeline

Actions flow through middleware before reaching reducers:

```
dispatch(action)
  → Custom middleware registered on the Store (optional)
  → Redux-saga middleware (forwards actions to sagas)
  → Reducers
```

Key middleware:

| Middleware | Purpose |
| --- | --- |
| Store constructor middleware / Store.addMiddleware(...) | Registers app-specific Redux middleware before initialization |

## Store Initialization

The recommended Svelte-readable setup uses the canonical `Store` class exported by `@augmentcode/themis/svelte-store`:

```typescript
import { onDestroy, onMount } from 'svelte';
import { Store } from '@augmentcode/themis/svelte-store';
import type { StoreState } from '@augmentcode/themis/types';
import { counterReducer } from './slices/counter/counter-slice';
import { counterSaga } from './slices/counter/sagas/counter-saga';

export const store = new Store({ counter: counterReducer });
export type AppState = StoreState<typeof store>;

// In root layout:
const dispose = store.init();
onDestroy(dispose);
onMount(() => store.runSaga(counterSaga));
```

Pass only application-owned reducers to the concrete Store constructor map, then start application-owned sagas explicitly with `store.runSaga(sagaFn)` after `store.init()`. `Store` is the Svelte-readable class from `@augmentcode/themis/svelte-store`; `ReactStore` is exported separately from `@augmentcode/themis/react-store` for Preact React signal selector results and React `.useValue(...)` component reads; `StreamingStore` is exported separately from `@augmentcode/themis/streaming-store` for Kefir/observable selector results. All variants manage package-owned internals automatically under reserved `@internal_` names: internal reducers such as `@internal_storeUtility` are package-managed, and the internal saga manager starts during Store initialization.

Call `store.init(initialState?)` during root component initialization and register its returned disposer with `onDestroy`. That disposer delegates to `store.dispose()`, so `onDestroy(dispose)` remains the normal Svelte root-layout pattern while direct `store.dispose()` is available for tests or other code that owns the Store lifetime. Pass preloaded state directly to `store.init(initialState)` when needed. Call `store.initDevTool()` explicitly after `store.init()` only when the runtime should be exposed to devtools; it returns its own cleanup and is also cleaned up by `store.dispose()`.

Under the hood, `store.init()` combines the registered reducers, creates the Redux store with middleware, lets the concrete Store variant create its selector state source, and starts the package's saga manager. It does **not** start any app sagas — each app saga must be started explicitly via `store.runSaga(sagaFn)`. In Svelte layouts/components, call `store.runSaga(sagaFn)` from `onMount` and return the cancel function as the mount cleanup. In React apps, initialize `ReactStore` once at the app/root owner and clean up the disposer when that owner unmounts or the app/test runtime is torn down.

## Saga Lifecycle

Sagas are managed by the **saga manager** (`src/slices/saga-manager/`):

1. **Startup** — Consumers do not register the saga manager. When `store.init()` is called, it starts the package-owned manager; no app saga is started yet.
2. **Starting** — Sagas are started explicitly by function through `store.runSaga(sagaFn)`, which derives a manager name from the function and returns a cancel function. In a layout or component, call it inside `onMount` and return the cancel function for mount-scoped cleanup.
3. **Auto-restart** — If a saga crashes, the manager catches the error and restarts the saga with exponential backoff (1s, 2s, 4s, ... up to 10 minutes).
4. **Stopping** — When every cancel function returned by `store.runSaga(sagaFn)` has been invoked, the Store-owned lifecycle stops that derived saga name. Reference counting ensures the saga only stops when all mounters/controllers have cancelled. Full Store teardown is separate: `store.dispose()` and the dispose function returned by `store.init()` tear down the Store-owned runtime and stop saga tasks owned by that Store, including running app sagas forked by the package-owned manager.
5. **Context** — Every saga receives the actual Redux store in saga context. Selector channels use the Redux store's `getState()` / `subscribe()` path; Svelte readable selector internals are maintained by the Svelte Store variant and are not exposed through saga context.

### Saga Context

```typescript
type SagaContext = {
  reduxStore: ReduxStore;
};
```

Accessed in sagas via `yield* getContext("reduxStore")`. This is a package internal; app sagas should prefer selector `.effect(...)`, `waitFor(...)`, and selector-channel helpers instead of reading context directly.

## Key Concepts

### Actions

Actions are plain objects describing events. Created with `createAction()` and `createAsyncAction()` from the explicit utility leaf `@augmentcode/themis/utils/store/create-action`.

→ See [REDUCERS.md](./REDUCERS.md) for action creation patterns.

### Reducers

Pure functions that handle actions and produce new state. Created with `createReducer()` and its fluent `.with()` API.

→ See [REDUCERS.md](./REDUCERS.md)

### Selectors

Pure functions that extract and derive data from state. Production app-local selectors are created with the configured Store instance via `store.createSelector(...)`, which preserves `StoreState<typeof store>` inference and provides proxy-based memoization plus the selector return model of that Store class: Svelte readables for `Store`, Preact React signals plus `.useValue(...args)` for `ReactStore`, or Kefir streams for `StreamingStore`. Shared selector helpers should accept a configured Store instead of importing standalone selector creation utilities. Store-created selectors are already cached, optimized, and scheduled by Store internals; do not wrap them in additional `memoize`, manual cache maps, debounce/throttle, or scheduler layers.

→ See [SELECTORS.md](./SELECTORS.md)

### Collections

Normalized data structures for managing entities by ID with O(1) lookups and insertion-order preservation.

→ See [COLLECTIONS.md](./COLLECTIONS.md)

### Sagas

Generator-based side effect handlers using `typed-redux-saga`. Handle API calls, persistence, timers, event listeners, and complex workflows.

→ See [SAGAS.md](./SAGAS.md)

### Testing

Reducers and selectors are pure functions — test them directly. Sagas can be tested with `redux-saga-test-plan` or manual generator stepping.

→ See [TESTING.md](./TESTING.md)