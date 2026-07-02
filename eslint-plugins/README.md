# ESLint Architecture Rule Framework

This root directory is the local ESLint migration surface for the architecture gates. Wave 1 created the framework; Wave 2 added source-boundary and naming rules with fixture parity. Wave 3 added state, collection, and reducer rules; Wave 4 added saga, selector, channel, and Store registration rules; Wave 5 added test-pattern and Markdown example coverage. Existing public validators remain compatible while converted rules are adopted incrementally.

## Layout

- `index.mjs` exports exactly five composed domain root config values — `core`, `store`, `svelte`, `react`, and `streaming` — plus `plugins` as the named per-rule config map. The domain rule lists are derived from the `coreRulePlugins`/`storeRulePlugins`/`svelteRulePlugins`/`reactRulePlugins` groupings in `plugins/index.mjs`, so the roots stay aligned with the folder domains. Root configs register one private shared `themis` plugin object aggregated from the per-rule implementations; no raw aggregate plugin object is exported as a root API.
- Rule folders are grouped by domain directory: `core/` (package/source hygiene rules valid in any consumer), `store/` (Redux store runtime rules: state, actions, reducers, collections, selectors, and sagas), `svelte/` (Svelte component/store boundary rules), and `react/` (React counterparts of the Svelte rules plus React selector call-mode rules). Rule IDs stay flat (`themis/<rule-id>`); domains only organize the folders. There is no `streaming/` directory yet because the streaming domain has no domain-specific rules.
- `<domain>/<rule-id>/plugin.mjs` is the single implementation file for each active rule/check. Public per-rule imports and collection wiring point directly at this file, and the public subpath stays `@augmentcode/themis/eslint-plugins/plugins/<rule-id>` regardless of domain.
- `<domain>/<rule-id>/fixtures/` owns that rule's pass/fail examples for lightweight/static validation and docs. Aggregate-scope checks use a local fixture note when their current Wave 1 coverage is inline in framework/package verifier cases, and ESLint-disable coverage should stay in lightweight validation instead of committed suppression fixtures.
- `plugins/index.mjs` is the standalone plugin collection barrel for selected-subset composition. Public one-rule package imports still use `/eslint-plugins/plugins/<rule-id>`, and those exports target the same per-rule `plugin.mjs` implementation files.
- `rule-utils.mjs` contains shared utilities for path classification, rule metadata, and detailed report formatting. Suppression uses standard ESLint disable comments handled by ESLint itself.
- The resource-heavy root `*.test.mjs` rule suites have been removed. Use `scripts/package-validation.test.mjs` and direct import/config smoke checks for package/API validation instead of recreating or running broad ESLint rule suites.

## Rule metadata contract

Create rules with `createArchitectureRule({ ruleId, summary, why, fix, create })`. Every report should include a short problem summary, why the pattern violates the architecture guidance, and concrete fix guidance. The same fields are mirrored in `rule.meta.architecture` for docs and failure-output checks.

## ESLint disable comments

Converted rules use standard ESLint suppression comments:

- `// eslint-disable-next-line themis/<rule-id> -- reviewed reason`
- `/* eslint-disable themis/<rule-id> -- reviewed reason */`

Prefer narrow `themis/<rule-id>` disables and preserve the reviewed reason in examples. Broad disables should be rejected unless they have an explicit owner-reviewed migration or compatibility rationale.

## Parent-project usage

- Public commands remain compatible: `validate-architecture` routes through the ESLint-backed entrypoint, and `npm run validate:release` verifies the release runtime shape.
- Converted checks are registered as `themis/<rule-id>` ESLint rules. The root static configs register the shared plugin namespace once, list every architecture rule as `off` in the base entry, then enable each selected rule as `warn` in its scoped file/ignore entry. Aggregate cross-file checks keep their public diagnostics in the ESLint-backed architecture validator runner, and any future Svelte-template checks should use a tested ESLint runner/processor path.
- For validation in this package, use lightweight package/API checks such as `npx --no-install vitest run scripts/package-validation.test.mjs` and direct import/config smoke checks. Do not recreate or run `eslint-plugins/*.test.mjs` or individual ESLint rule test files as routine validation because the removed rule suites are known to risk high CPU or hangs.

The package exports three ESLint surfaces. `@augmentcode/themis/eslint-plugins` is the primary entrypoint: it exports the five static domain root configs (`core`, `store`, `svelte`, `react`, `streaming`) and the `plugins` per-rule flat-config map, and downstream parent-project configs should normally import only from it. The two lower-level surfaces are also public exports but target selected-rule composition and validator internals: `@augmentcode/themis/eslint-plugins/plugins` is the plugin collection barrel (named per-rule plugin objects plus the grouping maps such as `coreRulePlugins`, `storeRulePlugins`, `svelteRulePlugins`, `reactRulePlugins`, and the aggregated `architectureRulePlugins`/`architectureRules`), and `@augmentcode/themis/eslint-plugins/plugins/<rule-id>` resolves to that rule's `<domain>/<rule-id>/plugin.mjs` implementation. Both lower-level surfaces export raw ESLint plugin objects (`{ meta, rules }`), not flat-config entries, so consumers using them must wire `plugins`/`rules` config themselves. The root entrypoint exposes no `architecturePlugin`, `architectureConfig`, `sourceArchitectureConfig`, helper builders, raw plugin object, rule-config helpers, compatibility aliases, source/test file constants, or customization shims. The older `/eslint-architecture` package subpaths are removed and must not be used.

Each consumer project picks ONE domain root for its app path. In a parent project's `eslint.config.js`:

```js
import { svelte } from "@augmentcode/themis/eslint-plugins";

export default svelte;
```

Each root composes the lower layers (core, then store, then its domain rules); rules outside a root's selection remain present as explicit `off` entries:

| Root | Composition | Enabled rules | Use for |
| --- | --- | --- | --- |
| `core` | core only | 4 | Any JS/TS package (package/source hygiene only) |
| `store` | core + store | 40 | Packages that define state/sagas but no UI |
| `svelte` | core + store + svelte | 43 | Svelte consumer projects |
| `react` | core + store + react | 44 | React consumer projects |
| `streaming` | core + store | 40 | Node/server/worker consumers; gains streaming rules when they exist |

`plugins` is not a raw ESLint plugin object. It is a named map of per-rule flat-config entries for selected composition.

### Breaking change: `full` and `recommended` removed

The `full` and `recommended` roots bundled the svelte and react domains together and effectively served only Svelte consumers; they are removed outright (no deprecated aliases). Migrate by importing the domain root for your app path: Svelte consumers that imported `recommended` or `full` switch to `svelte`; React consumers switch to `react`; UI-free store packages switch to `store`; streaming/back-end consumers switch to `streaming`. The `plugins` per-rule config map and all `@augmentcode/themis/eslint-plugins/plugins/<rule-id>` subpaths are unchanged.

For selected composition, import `plugins` and export either named entries or `Object.values(plugins)`; do not call package helper builders because none are public API:

```js
import { plugins } from "@augmentcode/themis/eslint-plugins";

export default [
  plugins["source-shaped-package-import"],
  plugins["forbidden-redux-api"],
  plugins["direct-local-storage-usage"],
];
```

```js
import { plugins } from "@augmentcode/themis/eslint-plugins";

export default Object.values(plugins);
```

If a project needs custom files or levels, extend or map the imported flat-config array in its own `eslint.config.js`. Current architecture checks use `themis/<rule-id>` rules; do not configure native `no-restricted-imports`, `no-restricted-syntax`, or `no-restricted-globals` as package architecture replacements.

## Converted source-boundary and naming rules

The root static config includes the converted Wave 2 source-boundary rules as `themis/<rule-id>` rules at warning severity.

Each failure explains the failing code, why the boundary matters, how to fix it, and the rule id. Use rule-specific ESLint disables only for reviewed compatibility cases, for example `// eslint-disable-next-line themis/source-shaped-package-import -- legacy migration until removal`.

### `themis/forbidden-component-import`

Invalid:

```ts
import { put } from "typed-redux-saga";
```

Valid:

```ts
import { selectTodos } from "./todos-selectors";
```

Remediate by removing component imports of saga, reducer, bridge, or collection internals. Dispatch actions or read selectors instead.

### `themis/component-lifecycle-boundary`

Invalid:

```ts
onMount(() => {
  const dispatch = getDispatch();
  dispatch(loadTodos());
});
```

Valid:

```ts
const dispatch = getDispatch();

onMount(() => {
  dispatch(loadTodos());
});
```

Reviewed legacy migrations may use a rule-specific ESLint disable with owner/removal context:

```ts
// eslint-disable-next-line themis/component-lifecycle-boundary -- legacy component migration tracked separately
beforeUpdate(() => {
  const store = getReduxStore();
  store.dispatch(refreshTodos());
});
```

Remediate by binding dispatch/store-facing helpers during component setup, dispatching explicit actions from lifecycle callbacks or handlers, and using selectors for state reads.

### `themis/unnamespaced-action-type`

Invalid:

```ts
createAction("reset");
```

Valid:

```ts
createAction("todos/reset");
```

Remediate by giving every action type one owning slice namespace.

### `themis/create-action-owner`

Invalid:

```ts
// src/todos-actions.ts
createAction("todos/addTodo");
```

Valid:

```ts
// src/todos-slice.ts
createAction("todos/addTodo");
```

Remediate by creating action creators in the slice owner module. `createAsyncAction` is intentionally not covered by this placement gate until the architecture convention explicitly requires the same treatment.

### `themis/direct-local-storage-usage`

Invalid:

```ts
window.localStorage.setItem("prefs", value);
```

Valid:

```ts
yield* getLocalStorageJSON("prefs");
```

Remediate by routing storage reads/writes through the safe local-storage saga helpers.

### `themis/forbidden-redux-api`

Invalid:

```ts
import { createSlice } from "@reduxjs/toolkit";
```

Valid:

```ts
import { createAction } from "@augmentcode/themis/utils/store/create-action";
```

Remediate by using the package's Store-first utilities instead of raw RTK or removed middleware/context helpers.

### `themis/shared-svelte-store-boundary`

Invalid:

```ts
// src/stores/cart.store.svelte.ts
export const cart = { items: [] };
```

Valid:

```ts
// src/ui/Tooltip.store.svelte.ts
export const tooltipOpen = false;
```

Remediate by moving shared/domain state to Redux; keep Svelte stores local tocomponents or explicit migration fixtures.

### `themis/source-shaped-package-import`

Invalid:

```ts
import { createAction } from "@augmentcode/themis";
```

Valid:

```ts
import { createAction } from "@augmentcode/themis/utils/store/create-action";
```

Remediate by importing stable approved subpaths instead of root, `src`, init, middleware, or removed bridge entrypoints.

### `themis/pass-through-wrapper`

Invalid:

```ts
export { newFeature } from "./new-feature";
```

Valid:

```ts
export function legacyFeature(value) {
  return newFeature(value) + 1;
}
```

Remediate by deleting stale wrappers or documenting a reviewed compatibility exception with a narrow ESLint disable and sunset/removal conditions.

### `themis/state-type-name`

Invalid:

```ts
export type TodosStore = { count: number };
```

Valid:

```ts
export type TodosState = { count: number };
```

Remediate by naming exported reducer state shapes with a `State` suffix.

### `themis/selector-export-name`

Invalid:

```ts
export const getTodos = createSelector((state) => state.todos.items);
```

Valid:

```ts
export const selectTodos = createSelector((state) => state.todos.items);
```

Remediate by naming selectors in selectors files with the `select` prefix.

### `themis/selector-file-name`

Invalid:

```ts
// src/todos.ts
export const selectTodos = createSelector((state) => state.todos.items);
```

Valid:

```ts
// src/todos-selectors.ts
export const selectTodos = createSelector((state) => state.todos.items);
```

Remediate by moving exported `select*` selectors to a selectors file.

### `themis/single-slice-selectors-module`

Invalid:

```ts
// src/slices/todos/todos-slice.ts
// src/slices/todos/archive-slice.ts
// src/slices/todos/todos-selectors.ts
// src/slices/todos/archive-selectors.ts
```

Valid:

```ts
// src/slices/todos/todos-slice.ts
// src/slices/todos/todos-selectors.ts
// src/slices/archive/archive-slice.ts
// src/slices/archive/archive-selectors.ts
```

Remediate by keeping one `*-slice` module and one `*-selectors` module per slice directory. Split multiple slices into separate directories named after the slices instead of co-owning one directory.

### `themis/action-type-shape`

Invalid:

```ts
createAction("todos/add/success");
```

Valid:

```ts
createAction("todos/add");
```

Remediate by using exactly `sliceName/actionName` without empty or nested segments.

### `themis/camelcase-slice-identity`

Invalid:

```ts
createAction("user-preferences/updateTheme");
createAction("user_preferences/updateTheme");
export const store = new Store({ "user-preferences": userPreferencesReducer });
```

Valid:

```ts
createAction("userPreferences/updateTheme");
export const store = new Store({ userPreferences: userPreferencesReducer });
```

Remediate by keeping physical directories/files in kebab-case when desired, but using camelCase logical slice identity names for reducer-map keys and action type namespaces.

## Converted state, collection, and reducer rules

The root static config includes the converted Wave 3 state, collection, and reducer rules. `npm run validate:architecture` now reports ESLint-backed diagnostics while the fixtures prove rule coverage.

Each failure explains the failing code, why serializable/pure state matters, how to fix it, and the rule id. Deliberate exceptions should be rare and must use a rule-specific ESLint disable with an owner-reviewed reason and removal condition, for example `// eslint-disable-next-line themis/reducer-side-effect -- legacy side effect until TODO-123 extracts saga`.

### `themis/non-serializable-state-type`

Invalid:

```ts
export type TodosState = { loadedAt: Date };
```

Valid:

```ts
export type TodosState = { loadedAtIso: string };
```

Remediate by storing plain serializable representations in Redux state and constructing Date, Map, Set, Error, Promise, or function values outside the canonical state shape.

### `themis/non-serializable-initial-state`

Invalid:

```ts
export const initialState = { pendingIds: new Set<string>() };
```

Valid:

```ts
export const initialState = { pendingIds: [] as string[] };
```

Remediate by initializing Redux state with JSON-safe plain data and movingruntime object construction to selectors, sagas, components, or utilities.

### `themis/nondeterministic-reducer-state`

Invalid:

```ts
export const initialState = { generatedAt: Date.now() };
```

Valid:

```ts
export const initialState = { generatedAt: null as number | null };
```

Remediate by creating timestamps, random IDs, and UUIDs in action preparation orsaga code, then storing the produced payload value in the reducer.

### `themis/collection-state-shape`

Invalid:

```ts
export type TodosState = { todos: Todo[] };
```

Valid:

```ts
export type TodosState = { todos: Collection<Todo, TodoId>; selectedIds: TodoId[] };
```

Remediate by storing entities in `Collection<T, K>` and keeping ordering arrays limited to primitive values or IDs.

### `themis/collection-internal-mutation`

Invalid:

```ts
collection.map[todo.id] = todo;
```

Valid:

```ts
return collectionSet(collection, todo.id, todo);
```

Remediate by using collection helper functions. The only acceptable exception isinside the approved collection utility implementation with tests that preservemap, ids, and refsCount consistency.

### `themis/reducer-side-effect`

Invalid:

```ts
fetch(`/todos/${action.payload.id}`);
```

Valid:

```ts
return { ...state, ids: [...state.ids, action.payload.id] };
```

Remediate by moving IO, timers, storage, randomness, and timestamp creation to sagas or action preparation; reducers should only compute next state from state and action.

### `themis/async-reducer-handler`

Invalid:

```ts
createReducer(initialState).with(todoAdded, async (state, action) => state);
```

Valid:

```ts
createReducer(initialState).with(todoAdded, (state, action) => state);
```

Remediate by moving async work into sagas and dispatching a follow-up action with the resolved data.

## Converted saga, selector, channel, and Store registration rules

The root static config includes the converted Wave 4 saga, selector, channel, and Store registration rules. The public validator remains available through `validate-architecture`; `npm run validate:release` verifies the release runtime shape through the local ESLint plugin.

Each failure explains the unsafe saga, selector, channel, or registration pattern, why it breaks typing/lifecycle/state-read contracts, how to remediate it, and the rule id. Use rule-specific ESLint disables only for reviewed migration cases with an owner and removal condition.

### `themis/saga-watcher-action-type`

Invalid:

```ts
yield* takeEvery(loadTodos.type, loadTodosWorker);
```

Valid:

```ts
yield* takeEvery(loadTodos, loadTodosWorker);
```

Remediate by passing action creators directly to `take`, `takeEvery`, `takeLatest`, or `takeLeading` so typed-redux-saga preserves worker action typing.

### `themis/inline-saga-selector`

Invalid:

```ts
const ready = yield* select((state) => state.todos.ready);
```

Valid:

```ts
const ready = yield* selectReady.effect();
```

Remediate by moving state reads into named `select*` selectors and calling their `.effect()` helper from sagas.

### `themis/no-wildcard-saga-take`

Invalid:

```ts
function* watchAnything() {
  while (true) {
    const action = yield* take("*");
    yield* call(audit, action);
  }
}

yield* takeEvery(["*"], anyWorker);
```

Valid:

```ts
function* watchUserEvents() {
  yield* takeEvery([userLoggedIn, userLoggedOut], auditUserEventWorker);
}

function* watchReady() {
  yield* takeLatestFromSelector(selectIsReady, function* ({ payload }) {
    if (payload) yield* call(syncReadyState);
  });
}
```

Remediate by passing concrete action creators (or arrays of action creators) to `take`/`takeEvery`/`takeLatest`/`takeLeading`, or by reacting to a selector value change with a selector-channel helper. Wildcard `'*'` wakes the watcher for every dispatched action and devastates saga throughput during streaming bursts, and is especially harmful during streaming flows where chunk actions fire continuously. Detection covers the direct `take`/`takeEvery`/`takeLatest`/`takeLeading` callee shape; aliased typed-redux-saga imports are out of scope. This rule is distinct from `themis/saga-watcher-action-type`, which enforces passing action creators rather than `.type` strings to watcher effects.

### `themis/saga-local-selector`

Invalid:

```ts
// src/todos/todos-sagas.ts
const selectVisibleTodos = (state: AppState) => state.todos.visible;
const selectTodoById = (todoId: string) => (state: AppState) => state.todos.map[todoId];

function* watchVisibleTodos() {
  const visible = yield* select(selectVisibleTodos);
  const todo = yield* select(selectTodoById("first"));
}
```

Valid:

```ts
// src/todos/todos-sagas.ts
import { selectVisibleTodos, selectTodoById } from "./todos-selectors";

function* watchVisibleTodosGood() {
  const visible = yield* selectVisibleTodos.effect();
  const todo = yield* selectTodoById.effect("first");
}
```

Remediate by moving `select*` function or factory declarations out of saga modules and into the owning slice's `[slice]-selectors.ts`, then importing them into the saga file. Saga-local `select*` declarations are invalid even when they are not exported, because they put state-shape knowledge in the wrong layer and bypass selector ownership rules. This rule complements `themis/inline-saga-selector`, which rejects `yield* select((state) => ...)` call expressions.

### `themis/no-extra-selector-caching`

Invalid:

```ts
const cachedSelectTodos = memoize(() => selectTodos());
const throttledReady = throttle(() => selectReady.select(store.state), 100);
const readableTodos = readable([], (set) => selectTodos().subscribe(set));
```

Valid:

```ts
const ready = selectReady.select(store.state);

export const selectVisibleTodos = store.createSelector((state) => {
  return selectTodos.select(state).filter((todo) => todo.visible);
});

export const store = new Store(reducers, undefined, { throttledSelectorFrequency: 64 });
```

Remediate by removing obvious memoization and scheduling wrappers such as `memoize`, `useMemo`, `derived`/manual `readable`, `debounce`, and `throttle` around Store-created selectors or selector calls. Store selector machinery already caches accessed state paths, tracks arguments, and coalesces Store-family emissions; use normal direct selector calls, `.select(state, ...args)` composition, or public Store constructor options such as `throttledSelectorFrequency` instead.

### `themis/direct-selector-call-mode`

Invalid:

```ts
function handleClick() {
  return selectTodos();
}
```

Valid:

```ts
function handleClick(store) {
  return selectTodos.select(store.state);
}
```

Remediate by using `.select(state, args)` in callbacks, handlers, and tests, or `.effect(args)` in sagas. Reserve bare `selectFoo()` for component initialization where a Svelte readable can access component context.

### `themis/wait-for-named-selector`

Invalid:

```ts
yield* waitFor((state) => state.todos.ready, [], (ready) => ready);
```

Valid:

```ts
yield* waitFor(selectReady, [], (ready) => ready === true, 5000);
```

Remediate by creating a named selector with `store.createSelector` and passing that selector plus arguments to `waitFor`.

### `themis/typed-saga-yield-star`

Invalid:

```ts
const todos = yield call(api.fetchTodos);
```

Valid:

```ts
const todos = yield* call(api.fetchTodos);
```

Remediate by delegating typed-redux-saga effects and selector effects with `yield*`; bare `yield` returns descriptors and loses typed results.

### `themis/auto-forking-channel-helper`

Invalid:

```ts
yield* fork(takeLatestFromSelector, selectReady, readyWorker);
```

Valid:

```ts
yield* takeLatestFromSelector(selectReady, readyWorker);
```

Remediate by calling `takeEveryFromSelector`, `takeLatestFromSelector`, or `takeLeadingFromSelector` directly because they already fork and return a Task.

### `themis/raw-channel-cleanup`

Invalid:

```ts
const channel = yield* createChannelFromSelector(selectReady);
yield* take(channel);
```

Valid:

```ts
const channel = yield* createChannelFromSelector(selectReady);
try {
  yield* take(channel);
} finally {
  channel.close();
}
```

Remediate by closing raw selector/event channels in `finally`, or by using auto-cleanup selector channel helpers when manual channel control is unnecessary.

### `themis/store-constructor-saga-map`

Invalid:

```ts
const store = new Store(reducers, sagas);
```

Valid:

```ts
const store = new Store(reducers).registerSagas(sagas);
```

Remediate by constructing the Store with reducers/middleware only, then calling `store.registerSagas(sagasMap)` before `store.init()` or `store.runSaga(name)`.

## Converted test-pattern and Markdown example checks

The root static config includes the converted Wave 5 test-pattern rules. `npm run validate:architecture` keeps its public command and output shape, and test files are checked through the ESLint-backed entrypoint. For package export validation, use `npx --no-install vitest run scripts/package-validation.test.mjs` plus direct import/config smoke checks when safe; do not recreate or run individual ESLint rule test files.

Markdown examples are reviewed with the surrounding docs or skills change. Intentional bad examples should remain clearly labeled in the heading or first code lines as wrong/bad; otherwise add a focused `eslint-disable-next-line themis/<rule-id> -- reviewed reason` comment next to the legacy pattern.

Troubleshooting steps:

1. Read each diagnostic block from top to bottom: the first line is `<markdown-or-test-file>:<line>:<column>`, followed by aligned `Rule:`, `Problem:`, `Why:`, and `How to fix:` guidance.
2. For selector test failures, replace bare `selectFoo(mockState)` calls with `selectFoo.select(mockState, ...args)`.
3. For typed-redux-saga mock failures, add an `Array.isArray(fnOrDescriptor)` branch before delegating tuple and function calls to `redux-saga/effects.call`.
4. If a Markdown fence is intentionally noncompliant teaching material, label the heading or first code lines as `❌`, `WRONG`, or `BAD`; do not hide unreviewed examples behind broad ignores.

### `themis/test-selector-select`

Invalid: a test calls `selectVisibleTodos(mockState)` and accidentally exercises the Svelte-readable form. Valid: the test calls `selectVisibleTodos.select(mockState)`. Remediate by using `.select(state, args)` for mock-state assertions; reserve bare `selectFoo()` for component initialization examples.

### `themis/typed-saga-call-mock-guard`

Invalid: a `vi.mock("typed-redux-saga")` replacement exposes `call` but delegates every input directly to `effects.call`. Valid: the mock branches on `Array.isArray(fnOrDescriptor)` before delegating. Remediate by preserving tuple descriptors so redux-saga-test-plan can interpret `[context, method]` calls.

## React domain rules

The `react` domain mirrors the Svelte component/store boundary rules for React consumers and adds a React selector call-mode rule. The rules apply to `src/**/*.{jsx,tsx}` component files (and `src/**/*.store.{ts,tsx}` shared store modules for the store boundary rule) and are included only in the `react` root config.

### `themis/react-forbidden-component-import`

Invalid:

```tsx
// src/components/TodoList.tsx
import { put } from "typed-redux-saga";
```

Valid:

```tsx
// src/components/TodoList.tsx
import { selectTodos } from "./todos-selectors";
```

Remediate by removing component imports of saga, reducer, bridge, or collection internals. Dispatch actions or read selectors instead.

### `themis/react-component-lifecycle-boundary`

Invalid:

```tsx
useEffect(() => {
  const dispatch = getDispatch();
  dispatch(loadTodos());
}, []);
```

Valid:

```tsx
const dispatch = getDispatch();

useEffect(() => {
  dispatch(loadTodos());
}, [dispatch]);
```

Remediate by binding dispatch/store-facing helpers at component setup (outside `useEffect`/`useLayoutEffect`/`useInsertionEffect` callbacks and listener/timer callbacks), dispatching explicit actions from handlers, and using selectors for state reads.

### `themis/react-prefer-direct-selector`

Invalid:

```tsx
// src/components/TodosPanel.tsx
const todos = selectTodos.useValue();
const first = selectTodoById.useValue("first");
```

Valid:

```tsx
// src/components/TodosPanel.tsx
const todos = selectTodos();
return <p>{todos.value.length}</p>;
```

Remediate by calling the selector directly so the component consumes the `ReadonlySignal` it returns; `.useValue(...)` reads a throttled plain value and is only a fallback for consumers that cannot accept signals. Keep reviewed fallbacks behind a narrow `eslint-disable-next-line themis/react-prefer-direct-selector` comment with a reason. Non-selector `.useValue(...)` calls (objects not named `select<PascalCase>`) and non-component `.ts` files are not reported.

### `themis/shared-react-store-boundary`

Invalid:

```ts
// src/stores/cart.store.ts
import { signal } from "@preact/signals-react";

export const cartItems = signal([]);
```

Valid:

```tsx
// src/components/Tooltip.store.tsx
import { signal } from "@preact/signals-react";

export const tooltipOpen = signal(false);
```

Remediate by moving shared/domain state to Redux; keep module-level signal state local to components or explicit migration fixtures.