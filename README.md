# themis

> Redux + Saga state management with Svelte-readable, React-signal, and Kefir-observable selectors.

## What it is

`themis` is a custom package for moving shared state, async workflows, and derived data into explicit, testable Redux + Saga building blocks. It is not the official Redux Toolkit and does not use RTK APIs such as `createSlice`, `configureStore`, or `createAsyncThunk`. It ships three Store variants: `Store` (Svelte readables), `ReactStore` (Preact React signals), and `StreamingStore` (Kefir observables).

## When to use it

- Keep shared application state in one Redux store instead of ad hoc component or script state.
- Put API calls, subscriptions, timers, persistence, and other side effects in sagas instead of components.
- Read derived state through selectors matched to the caller: Svelte readables, Preact React signals, or Kefir streams, plus `.select(state, ...args)` for synchronous reads and `.effect(...args)` for sagas.
- Skip needless recomputation: proxy-based tracking records the exact state paths each selector reads, so unrelated state changes do not invalidate derived values.
- Coalesce selector emissions near frame rate so a store changing every 1ms does not force consumer work every 1ms.
- Model entity-heavy state with normalized collection helpers.

## Installation

```bash
npm install @augmentcode/themis
```

`redux`, `redux-saga`, `typed-redux-saga`, and `fast-equals` ship as direct dependencies of the package and are installed automatically. Install `svelte@^5` for the Svelte-readable entrypoint, or the optional `react` and `@preact/signals-react` peers for `ReactStore`, as required by the chosen Store family. For saga tests, `redux-saga-test-plan` is an optional dev dependency (`npm install -D redux-saga-test-plan`).

## Install AI skills

Installing `@augmentcode/themis` does **not** copy AI skills automatically. Skill installation is an explicit consumer workflow, separate from package installation.

### Consumer workflow

1. Install the package from npm:

```bash
npm install @augmentcode/themis
```

1. Copy the smallest bundle that matches the app. Each command copies explicitly to `.agents/skills/themis/` and creates or reuses the Claude-compatible `.claude/skills/themis` link to that canonical directory.

| App or need | Command |
| --- | --- |
| React | npx themis install-skills:react |
| Svelte/SvelteKit | npx themis install-skills:svelte |
| Node, server, worker, CLI, tests, or no UI | npx themis install-skills:streaming |
| Shared Redux/saga guidance only | npx themis install-skills:core |
| Every package skill family | npx themis install-skills or npx themis install-skills:all |

1. Verify the installed CLI and canonical bundle:

```bash
npx themis help
node -e "const fs=require('node:fs'); for (const p of ['.agents/skills/themis/SKILL.md','.agents/skills/themis/installed-skills.yml','.claude/skills/themis']) console.log(p, fs.realpathSync(p))"
```

Rerun the same install command to refresh an existing package install. Refresh is idempotent for unchanged files, removes stale package-owned files recorded by the previous manifest, and preserves user-authored or unrelated skills. An existing file, directory, or foreign link at `.claude/skills/themis` is never overwritten; it remains in place with a warning while the canonical `.agents/skills/themis` copy continues.

Before uninstalling, remove copied skills explicitly because npm 7+ does not run dependency-uninstall cleanup scripts:

```bash
npx themis cleanup-skills
npm uninstall @augmentcode/themis
```

Cleanup removes only manifest-listed package files, the owned Claude compatibility link (including an owned dangling link), and empty compatibility directories. It preserves foreign `.claude` paths and unrelated `.agents/skills` content. See [docs/INSTALLATION.md](https://github.com/augmentcode/themis/blob/main/docs/INSTALLATION.md) for the complete consumer and maintainer workflows.

## Quick start

All variants take app-owned reducer maps in the constructor, initialize once before use, and start each app saga explicitly with `store.runSaga(sagaFn)`.

### Svelte

Selectors return Svelte `Readable` values; register the init disposer with `onDestroy` and start sagas from `onMount`.

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Store } from '@augmentcode/themis/svelte-store';
  import { counterReducer } from './slices/counter/counter-slice';
  import { counterSaga } from './slices/counter/sagas/counter-saga';

  const store = new Store(
    { counter: counterReducer },
    undefined,
    { throttledSelectorFrequency: 64, sagaMonitor: true }
  );

  const dispose = store.init();
  onDestroy(dispose);

  onMount(() => store.runSaga(counterSaga));
</script>
```

### React

Direct selector calls return Preact `ReadonlySignal` values; React components and hooks read plain values with `.useValue(...args)`, throttled the same as direct signal output.

```tsx
import { ReactStore } from '@augmentcode/themis/react-store';
import { counterReducer } from './slices/counter/counter-slice';
import { counterSaga } from './slices/counter/sagas/counter-saga';

const reactStore = new ReactStore(
  { counter: counterReducer },
  undefined,
  { throttledSelectorFrequency: 64 }
);

const dispose = reactStore.init();
const cancelCounterSaga = reactStore.runSaga(counterSaga);

const selectCount = reactStore.createSelector((state) => state.counter.count);
const countSignal = selectCount();
console.log(countSignal.value);

function CounterLabel() {
  const count = selectCount.useValue();
  return <span>{count}</span>;
}

cancelCounterSaga();
dispose();
```

### Streaming

For Node, server, worker, CLI, test, and other non-Svelte consumers; direct selector calls return Kefir observables.

```ts
import { StreamingStore } from '@augmentcode/themis/streaming-store';
import { counterReducer } from './slices/counter/counter-slice';
import { counterSaga } from './slices/counter/sagas/counter-saga';

const streamStore = new StreamingStore(
  { counter: counterReducer },
  undefined,
  { throttledSelectorFrequency: 64 }
);

const dispose = streamStore.init();
const cancelCounterSaga = streamStore.runSaga(counterSaga);

const selectCount = streamStore.createSelector((state) => state.counter.count);
const countSubscription = selectCount().observe((count) => {
  console.log(count);
});

countSubscription.unsubscribe();
cancelCounterSaga();
dispose();
```

## Choosing a Store variant

| Variant | Import path | Direct selector returns | Component reads | Non-component reads |
| --- | --- | --- | --- | --- |
| Store | @augmentcode/themis/svelte-store | Svelte Readable | $selector / subscribe(...) | .select(state, ...args) |
| ReactStore | @augmentcode/themis/react-store | Preact ReadonlySignal | .useValue(...args) | signal .value or .select(state, ...args) |
| StreamingStore | @augmentcode/themis/streaming-store | Kefir Observable | — | .observe(...) or .select(state, ...args) |

All three constructors share the signature `new <Class>(reducersMap?, middleware?, options?)`; pass `undefined` for middleware when you only need options. `.useValue(...args)` is React-only; `.effect(...args)` creates a typed-redux-saga select effect for use inside sagas only.

## Public import paths

Use the public subpackage entrypoints in application code. There is no package root barrel and no `@augmentcode/themis/utils` barrel; import from the explicit subpath that owns the API.

| Subpackage | Use for |
| --- | --- |
| @augmentcode/themis/svelte-store | Canonical Svelte-readable Store class. |
| @augmentcode/themis/streaming-store | StreamingStore; its createSelector(...) results return Kefir observables. |
| @augmentcode/themis/react-store | ReactStore; its selectors return Preact React signals and expose .useValue(...args). |
| @augmentcode/themis/saga | Saga authoring helpers, selector-channel effects, retry/timeout utilities, and streaming helpers. |
| @augmentcode/themis/types | Public TypeScript types. |
| @augmentcode/themis/components-svelte/use-init-store, /use-run-saga | Optional Svelte lifecycle helper leaf imports; there is no components-svelte barrel. |
| @augmentcode/themis/utils/collections/collection-utils | Collection utility leaf import. |
| @augmentcode/themis/utils/store/create-action, /create-reducer, /boolean-preference, /domain-scoped | The only package-level store utility leaf imports. |
| @augmentcode/themis/utils/sagas/<leaf> | Approved saga utility leaves: debounce-saga, retry-with-timeout, wrap-async-generator, selector-channel-effects. |

## Store options

- `throttledSelectorFrequency` — Store-scoped selector cadence cap for all three variants; defaults to `64` FPS, accepts any finite value in the inclusive `1..256` range, and coalesces rapid updates to the latest pending selector result.
- `sagaMonitor: true` — enables Store-owned redux-saga monitoring; disabled by default, diagnostics only.
- `logReduxActions: true` — enables grouped Redux action/state logging; disabled by default and configured only when constructing the Store.
- `traceSelectors: true` — enables selector trace output; disabled by default, diagnostics only.
- `traceSelectors: { summaryEnabled: true, summaryIntervalMs: 1000 }` — opts into privacy-safe selector summary collection and controls its periodic publication cadence. `summaryEnabled` is the only switch that allocates the summary collector; detailed selector categories remain independently configurable.
- `loggerFactory` — replaces the built-in console logger for one Store instance. The factory receives the read-only `StoreTraceStreams` collection and may return a disposer.

### Logging and tracing streams

Every `Store`, `ReactStore`, and `StreamingStore` exposes the same frozen,
read-only `traceStreams` collection. Import `StoreTraceStreams` and
`StoreLoggerFactory` from `@augmentcode/themis/types` (the Store-family
entrypoints re-export these types as well). The collection contains Kefir
observables for `selectorDetail`, `selectorSummary`, `selectorCadence`,
`sagaMonitor`, `runtimeError`, and `reduxAction`; consumers can observe them but
cannot publish events or access the internal emitters. Redux middleware is a pure
event producer: it calls `next(action)` first, then publishes one immutable action
event containing the action and previous/next state references.

Without `loggerFactory`, StoreRuntime subscribes its default console logger and
keeps the existing severity and `[themis]` prefixes, including Redux action groups.
Supplying a factory attaches only that logger, so default console output is not
duplicated; the six streams remain available to the custom factory:

```ts
import { StreamingStore } from '@augmentcode/themis/streaming-store';
import type { StoreLoggerFactory } from '@augmentcode/themis/types';

const loggerFactory: StoreLoggerFactory = (streams) => {
  const subscription = streams.runtimeError.observe((event) => report(event));
  return () => subscription.unsubscribe();
};

const store = new StreamingStore(undefined, undefined, { loggerFactory });
const dispose = store.init();
```

The logger disposer is called by `store.dispose()` and before a later
re-initialization attaches the logger again. Dispose direct selector
subscriptions before disposing their Store; retain the initializer disposer
until the Store is no longer used. Summary intervals and other tracing
resources follow the same deterministic init/dispose lifecycle.

Names prefixed `@internal_` (such as the `@internal_storeUtility` reducer) and the internal saga manager are package-owned; do not register `@internal_` reducers, start internal sagas, or read those state domains from app code.

## Diagnostic logging

Selector tracing and Redux action logging are separate, opt-in diagnostics. All three Store families use the same third constructor argument for options; pass `undefined` as the middleware placeholder when no middleware is configured:

```typescript
const diagnosticOptions = {
  traceSelectors: {
    traceExecution: true,
    traceCache: true,
    summaryEnabled: true,
    summaryIntervalMs: 1000,
  },
  logReduxActions: true,
};

const store = new Store(reducers, undefined, diagnosticOptions);
// Use the same options with ReactStore or StreamingStore when that is the app's Store family:
// const store = new ReactStore(reducers, undefined, diagnosticOptions);
// const store = new StreamingStore(reducers, undefined, diagnosticOptions);
```

Use one concrete Store family per app. Both options default to `false`; omit them in normal builds and enable them only for a focused reproduction. Selector tracing is available in development and production when explicitly enabled. With `summaryEnabled: true`, after `store.init()` each non-empty selector interval emits one concise default-console title such as `[themis] selectors fired: 4, recalculated: 4` with a `{ intervalMs, selectors }` payload containing detailed frozen per-selector rows; the public `selectorSummary` stream retains detailed per-selector rows with interval counts, duration aggregates, invalidation/result/argument counts, and cache hit/miss metrics. The same option retains a deep-frozen lifetime snapshot from `store.getSelectorTraceSummary()`. Without `summaryEnabled`, no selector summary collector or periodic summary publication is allocated; detailed selector categories remain independently configurable. Period rows reset after emission while lifetime summaries continue accumulating, and idle periods are silent. Thresholds are inclusive and category-specific (`minDurationMs` and `minRecomputationCount` gate execution evidence; `minCacheMissCount` gates cache evidence). Selector records never contain state, selector arguments, selector results, or internal paths.

Redux action logging is a different stream. When `logReduxActions: true`, the pure logger middleware publishes one event after each successful `next(action)`; StoreRuntime's default logger renders a one-time `🔧 Redux Logger Active` legend and one collapsed console group per dispatch. Expand the group to read the action title and the styled `action` record, then the styled `state` record. Primitive payloads (or a one-element primitive array) may appear in the action title; complex payloads do not. Changed state uses a lazy, path-keyed `changes` payload containing `prev`/`next` entries. Unchanged state uses the gray `state (no changes)` record with `{ state: nextState }`; it means the reducer returned the same state reference, not that logging failed. Redux action events retain action/state references for custom loggers, so redact secrets and personal data before sharing them. Selector aggregates and Redux action groups should not be interpreted as interchangeable evidence.

Both diagnostics follow Store lifecycle boundaries: initialize before dispatching or using direct reactive selectors, retain the disposer returned by `store.init()`, and call it (or `store.dispose()`) when the Store is no longer used. Disposal stops selector aggregate intervals and clears pending period data. Diagnostic options are construction-time configuration: to disable selector tracing, omit `traceSelectors` or set it to `false` on a newly constructed Store; to disable Redux action logging, omit `logReduxActions` or set it to `false` and construct a new Store. There is no Redux logger dev-mode, localStorage, global debug-console, or runtime toggle. The legacy `store.traceSelectors()` method can activate the compatibility tracing preset only for a Store constructed with omitted/`false` tracing options; a configured tracing object remains authoritative.

For a slow selector, start with the smallest useful tracing categories, initialize the Store, reproduce the real interaction, and filter for `[themis] selectors fired:`. For a dispatch issue, enable `logReduxActions`, expand the relevant action group, inspect only the needed lazy diff paths, redact captured values, then dispose the diagnostic Store and remove the temporary options.

## Lifecycle

`store.init(initialState?)` prepares the Redux store, starts the internal saga manager, and returns a disposer (in Svelte, register it with `onDestroy`); it does not auto-start app sagas. `store.runSaga(sagaFn)` starts one saga and returns a cancel function. `store.dispose()` tears down the initialized context and stops saga tasks owned by it. Infer the app state type from the configured store with `StoreInstanceState<typeof store>` from `@augmentcode/themis/types` (`StoreState<typeof store>` remains supported).

## CLI and skills

Run the package bin with `npx themis help` (or `./node_modules/.bin/themis help`) to list commands. In this repository's source checkout the package bin is not linked automatically, so run `node scripts/cli.mjs help` instead. Skill installs — `install-skills:react`, `install-skills:svelte`, `install-skills:streaming`, or `install-skills` (alias of `install-skills:all`) — copy the selected bundle only into canonical `.agents/skills/themis/` and record an `installed-skills.yml` manifest there. They also create or reuse the relative `.claude/skills/themis` compatibility link to that canonical tree; existing files, directories, or foreign links at that path are preserved with a warning. Run `cleanup-skills` before uninstalling; it removes manifest-listed files, the owned Claude compatibility link, and only empty compatibility directories. See [docs/INSTALLATION.md](https://github.com/augmentcode/themis/blob/main/docs/INSTALLATION.md) for full install, refresh, cleanup, and uninstall behavior.

## ESLint

Import exactly one composed domain root config from `@augmentcode/themis/eslint-plugins` per app path: `core` (any JS/TS package), `store` (state/saga packages without UI), `svelte`, `react`, or `streaming`. The former `full`/`recommended` roots and the `@augmentcode/themis/eslint-architecture` specifiers are removed. The `validate-architecture` CLI command is also removed; consuming apps get architecture checking through these ESLint root configs.

## Learn more

[docs/](https://github.com/augmentcode/themis/tree/main/docs/) is the human-facing source of truth; [skills/](https://github.com/augmentcode/themis/tree/main/skills/) is concise agent-facing execution guidance that links back to the docs.

- [docs/ARCHITECTURE.md](https://github.com/augmentcode/themis/blob/main/docs/ARCHITECTURE.md) — store setup, data flow, selector tracking, and saga lifecycle.
- [docs/INSTALLATION.md](https://github.com/augmentcode/themis/blob/main/docs/INSTALLATION.md) — manual Skills installation, cleanup/uninstall behavior, and maintainer validation.
- [docs/SELECTORS.md](https://github.com/augmentcode/themis/blob/main/docs/SELECTORS.md) — selector creation, memoization, component reads, non-component reads, and saga usage.
- [docs/SAGAS.md](https://github.com/augmentcode/themis/blob/main/docs/SAGAS.md) — typed saga patterns for async workflows.
- [docs/COLLECTIONS.md](https://github.com/augmentcode/themis/blob/main/docs/COLLECTIONS.md) — normalized entity state helpers.
- [docs/TESTING.md](https://github.com/augmentcode/themis/blob/main/docs/TESTING.md) — reducer, selector, and saga testing strategies.
- [skills/SKILL.md](https://github.com/augmentcode/themis/blob/main/skills/SKILL.md) — root router for choosing Core, Svelte, React, or Streaming skill families.
- [skills/core/](https://github.com/augmentcode/themis/tree/main/skills/core/) — framework-independent Redux and redux-saga agent guidance.
- [skills/svelte/](https://github.com/augmentcode/themis/tree/main/skills/svelte/) — Svelte-specific agent execution guidance, including [skills/svelte/migration/](https://github.com/augmentcode/themis/tree/main/skills/svelte/migration/).
- [skills/react/](https://github.com/augmentcode/themis/tree/main/skills/react/) — ReactStore and Preact signal selector guidance.
- [skills/streaming/](https://github.com/augmentcode/themis/tree/main/skills/streaming/) — StreamingStore and Kefir/observable selector guidance.
- [skills/setup/](https://github.com/augmentcode/themis/tree/main/skills/setup/) — canonical greenfield setup workflow.

## Maintainer validation

From a clean checkout of this repository, run `pnpm install --frozen-lockfile` (`pnpm-lock.yaml` is the only tracked lockfile), then:

```bash
npm run validate:architecture
npm test
npm run build
npm run validate:release
```

See [docs/INSTALLATION.md](https://github.com/augmentcode/themis/blob/main/docs/INSTALLATION.md) for what each gate checks and the expected passing output.

## License

MIT