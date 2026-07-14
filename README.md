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

`redux`, `redux-saga`, `typed-redux-saga`, and `fast-equals` ship as direct dependencies of the package and are installed automatically. `svelte@^5` is the only peer dependency, required because the Svelte-readable entrypoint ships in the package; Svelte apps and frameworks normally provide it. `ReactStore` consumers should use it from React apps that can load `@preact/signals-react`. For saga tests, `redux-saga-test-plan` is an optional dev dependency (`npm install -D redux-saga-test-plan`).

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
- `traceSelectors: true` — enables selector trace output; disabled by default, diagnostics only.

Names prefixed `@internal_` (such as the `@internal_storeUtility` reducer) and the internal saga manager are package-owned; do not register `@internal_` reducers, start internal sagas, or read those state domains from app code.

## Lifecycle

`store.init(initialState?)` prepares the Redux store, starts the internal saga manager, and returns a disposer (in Svelte, register it with `onDestroy`); it does not auto-start app sagas. `store.runSaga(sagaFn)` starts one saga and returns a cancel function. `store.dispose()` tears down the initialized context and stops saga tasks owned by it. Infer the app state type from the configured store with `StoreInstanceState<typeof store>` from `@augmentcode/themis/types` (`StoreState<typeof store>` remains supported).

## CLI and skills

Run the package bin with `npx themis help` (or `./node_modules/.bin/themis help`) to list commands. In this repository's source checkout the package bin is not linked automatically, so run `node scripts/cli.mjs help` instead. Skill installs — `install-skills:react`, `install-skills:svelte`, `install-skills:streaming`, or `install-skills` (alias of `install-skills:all`) — write the selected bundle into `.agents/skills/themis/` and record an `installed-skills.yml` manifest there. Run `cleanup-skills` before uninstalling; it removes only manifest-listed files plus the manifest itself. See [docs/INSTALLATION.md](./docs/INSTALLATION.md) for full install, refresh, cleanup, and uninstall behavior.

## ESLint

Import exactly one composed domain root config from `@augmentcode/themis/eslint-plugins` per app path: `core` (any JS/TS package), `store` (state/saga packages without UI), `svelte`, `react`, or `streaming`. The former `full`/`recommended` roots and the `@augmentcode/themis/eslint-architecture` specifiers are removed. The `validate-architecture` CLI command is also removed; consuming apps get architecture checking through these ESLint root configs.

## Learn more

`docs/` is the human-facing source of truth; `skills/` is concise agent-facing execution guidance that links back to the docs.

- `docs/ARCHITECTURE.md` — store setup, data flow, selector tracking, and saga lifecycle.
- `docs/INSTALLATION.md` — manual Skills installation, cleanup/uninstall behavior, and maintainer validation.
- `docs/SELECTORS.md` — selector creation, memoization, component reads, non-component reads, and saga usage.
- `docs/SAGAS.md` — typed saga patterns for async workflows.
- `docs/COLLECTIONS.md` — normalized entity state helpers.
- `docs/TESTING.md` — reducer, selector, and saga testing strategies.
- `skills/SKILL.md` — root router for choosing Core, Svelte, React, or Streaming skill families.
- `skills/core/` — framework-independent Redux and redux-saga agent guidance.
- `skills/svelte/` — Svelte-specific agent execution guidance, including `skills/svelte/migration/`.
- `skills/react/` — ReactStore and Preact signal selector guidance.
- `skills/streaming/` — StreamingStore and Kefir/observable selector guidance.
- `skills/setup/` — canonical greenfield setup workflow.

## Maintainer validation

From a clean checkout of this repository, run `pnpm install --frozen-lockfile` (`pnpm-lock.yaml` is the only tracked lockfile), then:

```bash
npm run validate:architecture
npm test
npm run build
npm run validate:release
```

See [docs/INSTALLATION.md](./docs/INSTALLATION.md) for what each gate checks and the expected passing output.

## License

MIT