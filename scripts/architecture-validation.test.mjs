import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { architectureRules, formatDiagnostics, shouldColorizeDiagnostics, validateArchitecture } from "./validate-architecture.mjs";
import { architectureRuleDomainById } from "./validate-release.mjs";

const tempRoots = [];

async function writeFixtureFile(root, path, content) {
  const fullPath = join(root, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

async function createFixture(files) {
  const root = await mkdtemp(join(tmpdir(), "srt-architecture-"));
  tempRoots.push(root);
  await Promise.all(Object.entries(files).map(([path, content]) => writeFixtureFile(root, path, content)));
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function readRuleFixture(ruleId, name) {
  return readFile(new URL(`../eslint-plugins/${architectureRuleDomainById[ruleId]}/${ruleId}/fixtures/${name}.ts`, import.meta.url), "utf8");
}

describe("architecture validation gate", () => {
  it("accepts unique action, selector, saga, and source-state patterns", async () => {
    const root = await createFixture({
      "src/todos-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        export type TodosState = { todos: TodoCollection; loadStatus: "idle" | "loading"; };
        const initialState: TodosState = { todos: createCollection(), loadStatus: "idle" };
        export const addTodo = createAction("todos/add");
        export const removeTodo = createAction("todos/remove");
      `,
      "src/todos-selectors.ts": `
        const store = { createSelector: (selector) => selector };
        export const selectTodos = store.createSelector((state) => state.todos.todos);
        export const selectLoadStatus = store.createSelector((state) => state.todos.loadStatus);
      `,
      "src/todos-saga.ts": `
        export function* todosSaga() {}
        store.addSaga("todos", todosSaga);
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
    expect(result.files).toHaveLength(3);
  });

  it("createAction placement accepts slice owners and reports non-slice modules", async () => {
    const root = await createFixture({
      "src/todos-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        export const addTodo = createAction("todos/addTodo");
      `,
      "src/preferences-slice.tsx": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        export const updatePreference = createAction("preferences/updatePreference");
      `,
      "src/todos-actions.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        export const removeTodo = createAction("todos/removeTodo");
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.createActionOwner);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      file: "src/todos-actions.ts",
      message: "createAction(...) calls should live in slice owner modules (*-slice.ts/tsx/mts/cts).",
    });
  });

  it("createAction placement accepts only approved utility/factory exception modules", async () => {
    const root = await createFixture({
      "src/utils/store/boolean-preference.ts": `
        import { createAction } from "./create-action";
        export function createBooleanPreference(sliceName) {
          const setAction = createAction("preferences/setEnabled");
          const toggleAction = createAction("preferences/toggleEnabled");
          return { setAction, toggleAction };
        }
      `,
      "src/utils/store/create-action.ts": `
        export function createAsyncAction(stagesActionType) {
          const successAction = createAction("async/success");
          const failureAction = createAction("async/failure");
          return { successAction, failureAction };
        }
      `,
      "src/utils/store/other-factory.ts": `
        import { createAction } from "./create-action";
        export const misplacedUtilityAction = createAction("otherFactory/misplacedUtilityAction");
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.createActionOwner);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ file: "src/utils/store/other-factory.ts" });
  });

  it("createAction placement supports disables and leaves createAsyncAction out of scope", async () => {
    const root = await createFixture({
      "src/legacy-actions.ts": `
        import { createAction, createAsyncAction } from "@augmentcode/themis/utils/store/create-action";
        // eslint-disable-next-line architecture/create-action-owner -- legacy compatibility alias kept until slice migration
        export const legacyReset = createAction("legacy/reset");
        export const loadLegacy = createAsyncAction("legacy/load", "legacy/loadSuccess", async () => ({}));
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
  });

  it("reports multiple slice and selectors owner modules in one slice directory", async () => {
    const root = await createFixture({
      "src/slices/todos/archive-slice.mts": "export const archiveReducer = undefined;",
      "src/slices/todos/archive-selectors.cts": "export const archiveSelectors = undefined;",
      "src/slices/todos/todos-slice.ts": "export const todosReducer = undefined;",
      "src/slices/todos/todos-selectors.ts": "export const todosSelectors = undefined;",
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.singleSliceSelectorsModule);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("contains 2 slice owner modules"),
        expect.stringContaining("contains 2 selectors owner modules"),
      ])
    );
    expect(diagnostics[0].message).toContain("split multiple slices into separate directories named after the slices");
    expect(diagnostics.flatMap(({ locations }) => locations.map(({ label }) => label))).toEqual(
      expect.arrayContaining(["archive-slice.mts", "todos-slice.ts", "archive-selectors.cts", "todos-selectors.ts"])
    );
  });

  it("accepts sibling slice directories with one slice and selectors owner each", async () => {
    const root = await createFixture({
      "src/slices/archive/archive-slice.ts": "export const archiveReducer = undefined;",
      "src/slices/archive/archive-selectors.ts": "export const archiveSelectors = undefined;",
      "src/slices/todos/todos-slice.ts": "export const todosReducer = undefined;",
      "src/slices/todos/todos-selectors.ts": "export const todosSelectors = undefined;",
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.singleSliceSelectorsModule)).toEqual([]);
  });

  it("reports intentional architecture violations with actionable rule names", async () => {
    const root = await createFixture({
      "src/actions-a.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        export const addTodo = createAction("todos/add");
      `,
      "src/actions-b.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        export const appendTodo = createAction("todos/add");
      `,
      "src/selectors-a.ts": `
        import { createSelector } from "@augmentcode/themis";
        export const selectTodos = createSelector((state) => state.todos.todos);
        export const selectCompletedTodos = createSelector((state) => state.todos.completedTodos);
      `,
      "src/selectors-b.ts": `
        import { createSelector } from "@augmentcode/themis";
        export const selectTodos = createSelector((state) => state.todos.visibleTodos);
        export const selectDoneTodos = createSelector((state) => state.todos.completedTodos);
      `,
      "src/sagas-a.ts": `
        export function* todosSaga() {}
        store.addSaga("todos", todosSaga);
      `,
      "src/sagas-b.ts": `
        export function* todosSaga() {}
        const sagas = { todos: todosSaga, todos: otherSaga };
      `,
      "src/state.ts": `
        export type TodosState = {
          todos: Todo[];
          filteredTodos: Todo[];
          todoCount: number;
          todoIds: string[];
        };
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const rules = new Set(result.diagnostics.map((diagnostic) => diagnostic.rule));
    const formatted = formatDiagnostics(result.diagnostics);

    expect([...rules]).toEqual(
      expect.arrayContaining([
        architectureRules.duplicateActionType,
        architectureRules.duplicateSelectorExport,
        architectureRules.duplicateSelectorImplementation,
        architectureRules.duplicateSagaName,
        architectureRules.duplicateSagaRegistration,
        architectureRules.suspiciousStateField,
        architectureRules.duplicateStateField,
      ])
    );
    expect(formatted).toContain("Duplicate action type string \"todos/add\"");
    expect(formatted).toContain("Duplicate selector export \"selectTodos\"");
    expect(formatted).toContain("Suspicious Redux state field \"filteredTodos\"");
  });

  it("formats human-readable diagnostics with aligned guidance and related locations", () => {
    const formatted = formatDiagnostics(
      [
        {
          rule: architectureRules.duplicateActionType,
          file: "src/actions-a.ts",
          line: 3,
          column: 31,
          message: 'Duplicate action type string "todos/add" found in 2 places. Action types must be globally unique.',
          locations: [
            { file: "src/actions-a.ts", line: 3, column: 31, label: "addTodo" },
            { file: "src/actions-b.ts", line: 3, column: 34, label: "appendTodo" },
          ],
        },
      ],
      { color: false }
    );

    expect(formatted).toBe(`1. src/actions-a.ts:3:31
  Rule:        duplicate-action-type
  Problem:     Duplicate action type string "todos/add" found in 2 places. Action types must be globally unique.
  Why:         Action types must be globally unique so action ownership and saga routing stay unambiguous.
  How to fix:  Rename one action type or reuse the existing action creator.
  Locations:
    - src/actions-a.ts:3:31 addTodo
    - src/actions-b.ts:3:34 appendTodo`);
  });

  it("colors only human-readable diagnostic labels and locations when requested", () => {
    const diagnostic = {
      rule: architectureRules.actionTypeShape,
      file: "src/actions.ts",
      line: 4,
      column: 28,
      message: "Action type string literals should use exactly one non-empty namespace segment: sliceName/actionName.",
    };

    expect(formatDiagnostics([diagnostic], { color: false })).not.toMatch(/\x1b\[[0-9;]+m/);
    expect(formatDiagnostics([diagnostic], { color: true })).toMatch(/\x1b\[[0-9;]+m/);
    expect(formatDiagnostics([diagnostic], { color: true })).toContain(diagnostic.message);
  });

  it("enables diagnostic color for TTY, CI, and forced-color environments unless disabled", () => {
    expect(shouldColorizeDiagnostics({ env: { FORCE_COLOR: "1" }, stream: { isTTY: false } })).toBe(true);
    expect(shouldColorizeDiagnostics({ env: { CI: "true" }, stream: { isTTY: false } })).toBe(true);
    expect(shouldColorizeDiagnostics({ env: {}, stream: { isTTY: true } })).toBe(true);
    expect(shouldColorizeDiagnostics({ env: { NO_COLOR: "1", CI: "true" }, stream: { isTTY: true } })).toBe(false);
    expect(shouldColorizeDiagnostics({ env: { FORCE_COLOR: "0" }, stream: { isTTY: true } })).toBe(false);
  });

  it("supports ESLint disable comments for reviewed false-positive exceptions", async () => {
    const root = await createFixture({
      "src/legacy.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        /* eslint-disable architecture/create-action-owner -- legacy actions stay outside slice until migration */
        export const addTodo = createAction("todos/add");
        // eslint-disable-next-line architecture/duplicate-action-type -- compatibility alias during migration
        export const appendTodo = createAction("todos/add");
        /* eslint-disable architecture/suspicious-state-field -- persisted API snapshot, not local derivation */
        export type SearchState = { filteredResults: string[]; };
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts compliant Wave 1 architecture-gate patterns", async () => {
    const root = await createFixture({
      "src/Todos.svelte": `
        <script lang="ts">
          import { store } from "$lib/store";
          import { selectTodos } from "./todos-selectors";
          import { loadTodos } from "./todos-slice";
          function readOnce() { return selectTodos.select(store.state); }
        </script>
      `,
      "src/todos-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        export type TodosState = { updatedAtMs: number; todoIds: string[]; };
        export const loadTodos = createAction("todos/loadTodos");
      `,
      "src/todos-selectors.ts": `
        import { store } from "$lib/store";
        export const selectTodos = store.createSelector((state) => state.todos.todoIds);
      `,
      "src/sagas/todos-saga.ts": `
        import { takeEvery } from "typed-redux-saga";
        import { getLocalStorageJSON } from "../utils/safe-local-storage-saga";
        import { loadTodos } from "../todos-slice";
        import { selectTodos } from "../todos-selectors";
        function* worker() {
          const ids = yield* selectTodos.effect();
          yield* getLocalStorageJSON<string[]>("todos");
        }
        export function* todosSaga() { yield* takeEvery(loadTodos, worker); }
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
  });

  it("reports Wave 1 high-signal architecture violations", async () => {
    const root = await createFixture({
      "src/Todos.svelte": `
        <script lang="ts">
          import { put } from "typed-redux-saga";
          import { todosSaga } from "./sagas/todos-saga";
        </script>
      `,
      "src/actions.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        export const reset = createAction("reset");
      `,
      "src/todos-slice.ts": `
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        export type TodosState = {
          lastLoadedAt: Date | null;
          itemsById: Map<string, Todo>;
        };
        const initialState: TodosState = { lastLoadedAt: null, itemsById: {} as Map<string, Todo> };
        export const todosReducer = createReducer<TodosState>(initialState);
      `,
      "src/utils/unsafe-storage.ts": `
        export function save(value) { window.localStorage.setItem("todos", value); }
      `,
      "src/sagas/todos-saga.ts": `
        import { select, takeEvery } from "typed-redux-saga";
        import { reset } from "../actions";
        function* worker() { yield* select((state) => state.todos.itemsById); }
        export function* todosSaga() { yield* takeEvery(reset.type, worker); }
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const rules = new Set(result.diagnostics.map((diagnostic) => diagnostic.rule));

    expect([...rules]).toEqual(
      expect.arrayContaining([
        architectureRules.forbiddenComponentImport,
        architectureRules.unnamespacedActionType,
        architectureRules.nonSerializableStateType,
        architectureRules.directLocalStorageUsage,
        architectureRules.sagaWatcherActionType,
        architectureRules.inlineSagaSelector,
      ])
    );
  });

  it("supports rule-specific ignores for Wave 1 gates", async () => {
    const root = await createFixture({
      "src/Legacy.svelte": `
        <script lang="ts">
          // eslint-disable-next-line architecture/forbidden-component-import -- legacy component owns migration cleanup until route removal
          import { put } from "typed-redux-saga";
        </script>
      `,
      "src/legacy-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        // eslint-disable-next-line architecture/unnamespaced-action-type -- public compatibility action during migration
        export const reset = createAction("reset");

        export type LegacyState = {
          // eslint-disable-next-line architecture/non-serializable-state-type -- persisted external object compatibility snapshot
          openedAt: Date;
        };
        const initialState: LegacyState = { openedAt: null as unknown as Date };
        export const legacyReducer = createReducer<LegacyState>(initialState);
      `,
      "src/legacy-storage.ts": `
        // eslint-disable-next-line architecture/direct-local-storage-usage -- compatibility bridge until storage helper migration finishes
        export function save(value) { window.localStorage.setItem("legacy", value); }
      `,
      "src/sagas/legacy-saga.ts": `
        import { select, takeEvery } from "typed-redux-saga";
        import { reset } from "../legacy-slice";
        function* worker() {
          // eslint-disable-next-line architecture/inline-saga-selector -- legacy selector extraction tracked separately
          yield* select((state) => state.legacy.openedAt);
        }
        export function* legacySaga() {
          // eslint-disable-next-line architecture/saga-watcher-action-type -- legacy watcher typing preserved during migration
          yield* takeEvery(reset.type, worker);
        }
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts compliant Wave 2 architecture-gate patterns", async () => {
    const root = await createFixture({
      "src/components/Tooltip.store.svelte.ts": `
        export const tooltipOpen = $state(false);
      `,
      "src/todos-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        import { createCollection, upsertItem } from "./utils/collections/collection-utils";
        type TodoId = string;
        type Todo = { id: TodoId; text: string };
        export type TodosState = { todos: Collection<Todo, "id">; todoOrder: TodoId[]; };
        const initialState: TodosState = { todos: createCollection<Todo, "id">(), todoOrder: [] as TodoId[] };
        export const addTodo = createAction("todos/addTodo");
        export const todosReducer = createReducer<TodosState>(initialState)
          .with(addTodo, (state, { payload: [todo] }) => ({ ...state, todos: upsertItem(state.todos, todo) }));
      `,
      "src/Todos.svelte": `
        <script lang="ts">
          import { store } from "$lib/store";
          function add(todo) { store.dispatch({ type: "todos/addTodo", payload: [todo] }); }
        </script>
      `,
      "src/feature.ts": `
        export function feature(value) { return value + 1; }
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
  });

  it("reports Wave 2 high-signal architecture violations", async () => {
    const root = await createFixture({
      "src/stores/cart.store.svelte.ts": `
        export const cart = $state({ items: [] });
      `,
      "src/rtk.ts": `
        import { createSlice } from "@reduxjs/toolkit";
        export const todosSlice = createSlice({ name: "todos", initialState: {}, reducers: {} });
      `,
      "src/todos-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        type TodoId = string;
        type Todo = { id: TodoId; text: string };
        export type TodosState = { todos: Todo[]; todoOrder: TodoId[]; };
        const initialState: TodosState = { todos: [] as Todo[], createdAt: new Date(), requestId: Math.random() };
        export const addTodo = createAction("todos/addTodo");
        export const todosReducer = createReducer<TodosState>(initialState)
          .with(addTodo, async (state) => {
            state.todos.map["a"] = { id: "a", text: "A" };
            window.localStorage.setItem("todos", "[]");
            return { ...state, updatedAt: Date.now() };
          });
      `,
      "src/Panel.svelte": `
        <script lang="ts">
          import { onMount } from "svelte";
          import { store } from "$lib/store";
          onMount(() => { store.dispatch({ type: "todos/addTodo" }); });
        </script>
      `,
      "src/legacy-wrapper.ts": `
        export { newFeature } from "./new-feature";
      `,
      "src/new-feature.ts": `
        export function newFeature() { return 1; }
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const rules = new Set(result.diagnostics.map((diagnostic) => diagnostic.rule));

    expect([...rules]).toEqual(
      expect.arrayContaining([
        architectureRules.forbiddenReduxApi,
        architectureRules.sharedSvelteStoreBoundary,
        architectureRules.collectionStateShape,
        architectureRules.collectionInternalMutation,
        architectureRules.nonSerializableInitialState,
        architectureRules.nondeterministicReducerState,
        architectureRules.reducerSideEffect,
        architectureRules.asyncReducerHandler,
        architectureRules.componentLifecycleBoundary,
        architectureRules.passThroughWrapper,
      ])
    );
  });

  it("covers nondeterministic reducer-state createAction payload modifier and transient Date sorting regression fixtures", async () => {
    const [validFixture, invalidFixture] = await Promise.all([
      readRuleFixture(architectureRules.nondeterministicReducerState, "valid"),
      readRuleFixture(architectureRules.nondeterministicReducerState, "invalid"),
    ]);
    const [validRoot, invalidRoot] = await Promise.all([
      createFixture({ "src/todos-slice.ts": validFixture }),
      createFixture({ "src/todos-slice.ts": invalidFixture }),
    ]);

    const [validResult, invalidResult] = await Promise.all([
      validateArchitecture({ root: validRoot, paths: ["src"] }),
      validateArchitecture({ root: invalidRoot, paths: ["src"] }),
    ]);
    const validDiagnostics = validResult.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.nondeterministicReducerState);
    const invalidDiagnostics = invalidResult.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.nondeterministicReducerState);
    const invalidMessages = invalidDiagnostics.map((diagnostic) => diagnostic.message).join("\n");

    expect(validFixture).toContain("new Date(a.timestamp).getTime()");
    expect(validDiagnostics).toEqual([]);
    expect(invalidMessages).toContain('"Date.now"');
    expect(invalidMessages).toContain('"Math.random"');
    expect(invalidMessages).toContain('"crypto.randomUUID"');
    expect(invalidMessages).toContain('"new Date"');
  });

  it("limits reducer-side-effect checks to createReducer with handler bodies", async () => {
    const root = await createFixture({
      "src/todos-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        type TodosState = { ids: string[]; createdAt: Date };
        const initialState: TodosState = { ids: [], createdAt: new Date() };
        export const addTodo = createAction("todos/addTodo", (text) => {
          fetch("/todos/prepare?text=" + text);
          const payload = { id: crypto.randomUUID(), tags: [] as string[], touchedAt: Date.now() };
          payload.tags.push(text);
          return { payload };
        });
        export const touchTodos = createAction("todos/touchTodos");
        export const resetTodos = createAction("todos/resetTodos");
        export const loadTodos = createAction("todos/loadTodos");
        export const generateTodos = createAction("todos/generateTodos");
        const resetHandler = (state) => ({ ...state, resetAt: Date.now() });
        export const todosReducer = createReducer<TodosState>(initialState)
          .with(addTodo, (state, { payload }) => {
            setTimeout(() => {}, 0);
            return { ...state, ids: [...state.ids, payload.id] };
          })
          .with(loadTodos, (state) => {
            fetch("/todos");
            localStorage.setItem("todos", "[]");
            window.location.href;
            return { ...state, loadedAt: new Date(), pending: new Promise((resolve) => resolve(state.ids)) };
          })
          .with(touchTodos, function (state) {
            return { ...state, seed: Math.random() };
          })
          .with(generateTodos, function (state) {
            return { ...state, requestId: crypto.randomUUID() };
          })
          .with(resetTodos, resetHandler);
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.reducerSideEffect);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");

    expect(diagnostics.length).toBeGreaterThanOrEqual(9);
    expect(messages).toContain('"fetch"');
    expect(messages).toContain('"timer"');
    expect(messages).toContain('"localStorage"');
    expect(messages).toContain('"DOM/window API"');
    expect(messages).toContain('"new Date"');
    expect(messages).toContain('"Promise"');
    expect(messages).toContain('"Math.random"');
    expect(messages).toContain('"Date.now"');
    expect(messages).toContain('"crypto.randomUUID"');
  });

  it("allows reducer-side-effect Date derivation for timestamp sorting but reports stored Date state values", async () => {
    const root = await createFixture({
      "src/workspace-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        type WorkspaceEvent = { id: string; timestamp: string };
        type WorkspaceState = { events: WorkspaceEvent[]; lastSeenAt: unknown };
        const initialState: WorkspaceState = { events: [], lastSeenAt: null };
        export const processWorkspaceEvents = createAction("workspace/processEvents");
        export const rememberWorkspaceEvent = createAction("workspace/rememberEvent");
        export const workspaceReducer = createReducer<WorkspaceState>(initialState)
          .with(processWorkspaceEvents, (state, { payload: [events] }) => {
            const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            return { ...state, events: sorted };
          })
          .with(rememberWorkspaceEvent, (state, { payload: [event] }) => {
            return { ...state, lastSeenAt: new Date(event.timestamp), refreshedAt: new Date() };
          });
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.reducerSideEffect);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");

    expect(diagnostics).toHaveLength(2);
    expect(messages.match(/"new Date"/g)).toHaveLength(2);
  });

  it("does not report reducer-side-effect diagnostics for action payload preparation when handlers are pure", async () => {
    const root = await createFixture({
      "src/todos-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        type TodosState = { ids: string[] };
        const initialState: TodosState = { ids: [] };
        export const addTodo = createAction("todos/addTodo", (text) => {
          fetch("/todos/prepare?text=" + text);
          const payload = { id: crypto.randomUUID(), tags: [] as string[], touchedAt: Date.now(), createdAt: new Date() };
          payload.tags.push(text);
          payload.tags.push(String(Math.random()));
          return { payload };
        });
        export const hydrateTodo = createAction("todos/hydrateTodo", (todo) => {
          const payload = { ...todo, prepared: true };
          payload.prepared = Boolean(localStorage.getItem("todos"));
          return { payload };
        });
        export const todosReducer = createReducer<TodosState>(initialState)
          .with(addTodo, (state, { payload }) => ({ ...state, ids: [...state.ids, payload.id] }))
          .with(hydrateTodo, (state, { payload }) => ({ ...state, ids: [...state.ids, payload.id] }));
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.reducerSideEffect);

    expect(diagnostics).toEqual([]);
  });

  it("checks only createReducer state types in slice modules for non-serializable type fields", async () => {
    const root = await createFixture({
      "src/todos-slice.ts": `
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        export interface UnusedState {
          unusedOpenedAt: Date;
          unusedErrorsById: Map<string, Error>;
        }
        type UnusedShape = {
          cachedAt: Date;
          cachedErrorsById: Map<string, Error>;
        };
        type SliceShape = {
          openedAt: Date | null;
          errorsById: Map<string, Error>;
        };
        // eslint-disable-next-line architecture/state-type-name -- verifies the target rule accepts arbitrary local state names
        const initialState: SliceShape = { openedAt: null, errorsById: {} as Map<string, Error> };
        // eslint-disable-next-line architecture/state-type-name -- verifies the target rule accepts arbitrary createReducer names
        export const todosReducer = createReducer<SliceShape>(initialState);
        export const inlineReducer = createReducer<{ retryAfter: Promise<void> | null }>({ retryAfter: null });
      `,
      "src/session.ts": `
        export type SessionState = { startedAt: Date; };
        export type SessionShape = { lastSeenAt: Date; sessionsById: Map<string, Error>; };
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.nonSerializableStateType);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");

    expect(diagnostics).toHaveLength(3);
    expect(messages).toContain("in SliceShape");
    expect(messages).toContain("in inline type literal");
    expect(messages).not.toContain("UnusedState");
    expect(messages).not.toContain("UnusedShape");
    expect(messages).not.toContain("SessionState");
    expect(messages).not.toContain("SessionShape");
    expect(messages).not.toContain("unusedOpenedAt");
    expect(messages).not.toContain("cachedAt");
    expect(messages).not.toContain("startedAt");
    expect(messages).not.toContain("lastSeenAt");
  });

  it("resolves imported createReducer state type implementations from relative project modules", async () => {
    const root = await createFixture({
      "src/todos-slice.ts": `
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        import type { TodosState as ImportedTodosState } from "./todos-state";
        import { type SessionState } from "./session-state";
        import type { RemoteShape } from "./remote-state";
        import type { SerializableShape } from "./serializable-shape";
        import type { MissingState } from "./missing-state";
        import type { PackageState } from "some-package";

        export const todosReducer = createReducer<ImportedTodosState>({} as ImportedTodosState);
        export const duplicateTodosReducer = createReducer<ImportedTodosState>({} as ImportedTodosState);
        export const sessionReducer = createReducer<SessionState>({} as SessionState);
        // eslint-disable-next-line architecture/state-type-name -- verifies imported non-State implementations are checked by the target rule
        export const remoteReducer = createReducer<RemoteShape>({} as RemoteShape);
        // eslint-disable-next-line architecture/state-type-name -- verifies valid imported non-State implementations stay serializable
        export const serializableReducer = createReducer<SerializableShape>({} as SerializableShape);
        export const missingReducer = createReducer<MissingState>({} as MissingState);
        export const packageReducer = createReducer<PackageState>({} as PackageState);
      `,
      "src/todos-state.ts": `
        type Timestamp = Date;
        export interface TodosState {
          openedAt: Timestamp | null;
          errorsById: Map<string, Error>;
        }
      `,
      "src/session-state.tsx": `
        type TimestampIso = string;
        export type SessionState = {
          openedAtIso: TimestampIso;
          byId: Record<string, { id: string }>;
        };
      `,
      "src/remote-state.ts": `
        type RemoteMeta = { openedAt: Date | null; };
        type RemoteFailures = Map<string, string>;
        export type RemoteShape = {
          meta: RemoteMeta;
          failuresById: RemoteFailures;
        };
      `,
      "src/serializable-shape.ts": `
        type TimestampIso = string;
        export interface SerializableShape {
          openedAtIso: TimestampIso;
          byId: Record<string, { id: string; updatedAtIso: string }>;
        }
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.nonSerializableStateType);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");

    expect(diagnostics).toHaveLength(4);
    expect(messages).toContain('Redux state field "openedAt" uses non-serializable type "Date" in TodosState');
    expect(messages).toContain('Redux state field "errorsById" uses non-serializable type "Error" in TodosState');
    expect(messages).toContain('Redux state field "meta" uses non-serializable type "Date" in RemoteShape');
    expect(messages).toContain('Redux state field "failuresById" uses non-serializable type "Map" in RemoteShape');
    expect(messages).not.toContain("SessionState");
    expect(messages).not.toContain("SerializableShape");
    expect(messages).not.toContain("MissingState");
    expect(messages).not.toContain("PackageState");
  });

  it("rejects removed package paths and forbidden RTK imports without helper-call diagnostics", async () => {
    const root = await createFixture({
      "src/root-import.ts": `
        import { createAction } from "@augmentcode/themis";
        export const addTodo = createAction("todos/addTodo");
      `,
      "src/rtk-imports.ts": `
        import { createSlice } from "@reduxjs/toolkit";
        import { createApi } from "@reduxjs/toolkit/query/react";
        export const todosSlice = createSlice({ name: "todos", initialState: {}, reducers: {} });
        export const todosApi = createApi({ reducerPath: "todosApi", endpoints: () => ({}) });
      `,
      "src/removed-imports.ts": `
        import { createMiddleware } from "@augmentcode/themis/middleware";
        import { init } from "@augmentcode/themis/init";
        import { getReduxStore } from "@augmentcode/themis/redux-dispatch-bridge";
        import { createReferenceChangeDetectorMiddleware } from "@augmentcode/themis/src/middleware";
        createMiddleware();
        createReferenceChangeDetectorMiddleware();
        createStoreContext();
        createReduxStoreContext();
        localStorage.setItem("debug-state-refs", "1");
      `,
      "src/middleware.ts": `export const stale = true;`,
      "src/middlewares/default.ts": `export const stale = true;`,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const rules = new Set(result.diagnostics.map((diagnostic) => diagnostic.rule));
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");

    expect(rules).toContain(architectureRules.sourceShapedPackageImport);
    expect(rules).toContain(architectureRules.forbiddenReduxApi);
    expect(messages).toContain("Use an exported @augmentcode/themis package subpath; root/source-shaped/removed paths are not public API.");
    expect(messages).toContain("Removed middleware source files are not allowed; use Store constructor middleware or Store.addMiddleware.");
    expect(messages).toContain("Use this package's Store-first Redux utilities instead of RTK helpers.");
    expect(messages).toContain("Do not import Redux Toolkit internals/subpaths from this package source.");
    expect(messages).not.toContain("Use current Store middleware/context APIs instead of removed Redux helper APIs.");
    expect(messages).not.toContain("debug-state-refs is a removed debug action type.");
  });

  it("supports rule-specific ignores for Wave 2 gates", async () => {
    const root = await createFixture({
      "src/stores/legacy.store.svelte.ts": `/* eslint-disable architecture/shared-svelte-store-boundary -- migration fixture until store deletion */
        export const legacy = $state({ items: [] });
      `,
      "src/rtk.ts": `
        /* eslint-disable architecture/forbidden-redux-api -- compatibility bridge until RTK migration removal */
        import { createSlice } from "@reduxjs/toolkit";
        export const todosSlice = createSlice({ name: "todos", initialState: {}, reducers: {} });
      `,
      "src/todos-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        type Todo = { id: string; text: string };
        export type TodosState = {
          // eslint-disable-next-line architecture/collection-state-shape -- external API compatibility until Collection migration
          todos: Todo[];
        };
        // eslint-disable-next-line architecture/non-serializable-initial-state, architecture/nondeterministic-reducer-state, architecture/reducer-side-effect -- legacy compatibility until persisted timestamp removal
        const initialState: TodosState = { todos: [], createdAt: new Date() };
        export const addTodo = createAction("todos/addTodo");
        export const todosReducer = createReducer<TodosState>(initialState)
          // eslint-disable-next-line architecture/async-reducer-handler -- legacy compatibility until saga extraction
          .with(addTodo, async (state) => {
            // eslint-disable-next-line architecture/collection-internal-mutation -- legacy migration until collection helper replacement
            state.todos.map["a"] = { id: "a", text: "A" };
            // eslint-disable-next-line architecture/reducer-side-effect, architecture/direct-local-storage-usage -- legacy compatibility until storage saga extraction
            window.localStorage.setItem("todos", "[]");
            return state;
          });
      `,
      "src/Panel.svelte": `
        <script lang="ts">
          import { onMount } from "svelte";
          import { store } from "$lib/store";
          // eslint-disable-next-line architecture/component-lifecycle-boundary -- legacy compatibility until callback migration
          onMount(() => { store.dispatch({ type: "todos/addTodo" }); });
        </script>
      `,
      "src/legacy-wrapper.ts": `
        // eslint-disable-next-line architecture/pass-through-wrapper -- legacy compatibility shim until consumers remove old path
        export { newFeature } from "./new-feature";
      `,
      "src/new-feature.ts": `
        export function newFeature() { return 1; }
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts compliant Wave 3 selector and saga lifecycle patterns", async () => {
    const root = await createFixture({
      "src/Todos.svelte": `
        <script lang="ts">
          import { store } from "$lib/store";
          import { selectReady } from "./todos-selectors";
          const ready$ = selectReady();
          function readOnce() { return selectReady.select(store.state); }
        </script>
      `,
      "src/todos-selectors.ts": `
        import { store } from "$lib/store";
        export const selectReady = store.createSelector((state) => state.todos.ready);
      `,
      "src/sagas/todos-saga.ts": `
        import { call, take } from "typed-redux-saga";
        import { waitFor, takeLatestFromSelector, createChannelFromSelector } from "@augmentcode/themis/saga";
        import { selectReady } from "../todos-selectors";
        function* worker() { yield* call(console.log, "ready"); }
        export function* todosSaga() {
          yield* waitFor(selectReady, [], (ready) => ready === true, 5000);
          yield* takeLatestFromSelector(selectReady, worker);
          const channel = yield* createChannelFromSelector(selectReady);
          try { yield* take(channel); } finally { channel.close(); }
        }
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
  });

  it("reports Wave 3 selector and saga lifecycle violations", async () => {
    const root = await createFixture({
      "src/Todos.svelte": `
        <script lang="ts">
          import { selectReady } from "./todos/todos-selectors";
          function handleClick() { const ready = selectReady(); return ready; }
        </script>
      `,
      "src/todos/todos-selectors.ts": `
        import { store } from "$lib/store";
        export const selectReady = store.createSelector((state) => state.todos.ready);
      `,
      "src/sagas/todos-saga.ts": `
        import { call, fork, take } from "typed-redux-saga";
        import { waitFor, takeLatestFromSelector, createChannelFromSelector } from "@augmentcode/themis/saga";
        import { selectReady } from "../todos/todos-selectors";
        function* worker() {}
        export function* todosSaga() {
          const ready = yield selectReady.effect();
          yield call(console.log, ready);
          yield* waitFor((state) => state.todos.ready, [], (value) => value === true);
          yield* fork(takeLatestFromSelector, selectReady, worker);
          const channel = yield* createChannelFromSelector(selectReady);
          while (true) { yield* take(channel); }
        }
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const rules = new Set(result.diagnostics.map((diagnostic) => diagnostic.rule));

    expect([...rules]).toEqual(
      expect.arrayContaining([
        architectureRules.directSelectorCallMode,
        architectureRules.waitForNamedSelector,
        architectureRules.typedSagaYieldStar,
        architectureRules.autoForkingChannelHelper,
        architectureRules.rawChannelCleanup,
      ])
    );
  });

  it("supports rule-specific ignores for Wave 3 gates", async () => {
    const root = await createFixture({
      "src/Legacy.svelte": `
        <script lang="ts">
          import { selectReady } from "./todos-selectors";
          function handleClick() {
            // eslint-disable-next-line architecture/direct-selector-call-mode -- legacy readable migration tracked separately
            const ready = selectReady();
            return ready;
          }
        </script>
      `,
      "src/todos-selectors.ts": `
        import { store } from "$lib/store";
        export const selectReady = store.createSelector((state) => state.todos.ready);
      `,
      "src/sagas/legacy-saga.ts": `
        import { call, fork, take } from "typed-redux-saga";
        import { waitFor, takeLatestFromSelector, createChannelFromSelector } from "@augmentcode/themis/saga";
        import { selectReady } from "../todos-selectors";
        function* worker() {}
        export function* legacySaga() {
          // eslint-disable-next-line architecture/typed-saga-yield-star -- legacy saga migration tracked separately
          yield call(console.log, "legacy");
          // eslint-disable-next-line architecture/wait-for-named-selector -- legacy inline selector migration tracked separately
          yield* waitFor((state) => state.todos.ready, [], (value) => value === true);
          // eslint-disable-next-line architecture/auto-forking-channel-helper -- legacy fork ownership tracked separately
          yield* fork(takeLatestFromSelector, selectReady, worker);
          // eslint-disable-next-line architecture/raw-channel-cleanup -- legacy channel lifecycle tracked separately
          const channel = yield* createChannelFromSelector(selectReady);
          while (true) { yield* take(channel); }
        }
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts compliant Wave 3 file-structure and test-pattern hygiene", async () => {
    const root = await createFixture({
      "src/todos-slice.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        export type TodosState = { todos: Collection<Todo, "id">; loadStatus: "idle" | "loading"; };
        const initialState: TodosState = { todos: createCollection<Todo, "id">(), loadStatus: "idle" };
        export const addTodo = createAction("todos/addTodo");
        export const todosReducer = createReducer<TodosState>(initialState);
      `,
      "src/todos-selectors.ts": `
        import { store } from "$lib/store";
        export const selectTodos = store.createSelector((state) => state.todos.todos);
      `,
      "src/todos-selectors.test.ts": `
        import { expect, it } from "vitest";
        import { selectTodos } from "./todos-selectors";
        it("reads selector output through .select", () => {
          const mockState = { todos: { todos: createCollection() } };
          expect(selectTodos.select(mockState)).toBe(mockState.todos.todos);
        });
      `,
      "src/todos-saga.test.ts": `
        import { vi } from "vitest";
        import * as sagaEffects from "redux-saga/effects";
        vi.mock("typed-redux-saga", () => ({
          call: function* (fnOrDescriptor, ...args) {
            return yield Array.isArray(fnOrDescriptor)
              ? sagaEffects.call(fnOrDescriptor, ...args)
              : sagaEffects.call(fnOrDescriptor, ...args);
          },
        }));
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
    expect(result.testFiles).toHaveLength(2);
  });

  it("reports Wave 3 file-structure and high-signal test-pattern violations", async () => {
    const root = await createFixture({
      "src/bad-slice.ts": `
        import { createAction, createReducer } from "@augmentcode/themis";
        export type TodosStore = { count: number };
        const initialState: TodosStore = { count: 0 };
        export const badAction = createAction("todos/add/success");
        export const todosReducer = createReducer<TodosStore>(initialState);
      `,
      "src/todos.ts": `
        import { createSelector } from "@augmentcode/themis";
        export const selectTodos = createSelector((state) => state.todos.todos);
      `,
      "src/orders-selectors.ts": `
        import { createSelector } from "@augmentcode/themis";
        export const getOrders = createSelector((state) => state.orders.items);
      `,
      "src/orders/orders-selectors.ts": `
        import { createSelector } from "@augmentcode/themis";
        export const selectOrders = createSelector((state) => state.orders.items);
      `,
      "src/todos-selectors.test.ts": `
        import { expect, it } from "vitest";
        import { selectOrders } from "./orders/orders-selectors";
        it("calls selector directly", () => {
          const mockState = { orders: { items: [] } };
          expect(selectOrders(mockState)).toEqual([]);
        });
      `,
      "src/todos-saga.test.ts": `
        import { vi } from "vitest";
        import * as sagaEffects from "redux-saga/effects";
        vi.mock("typed-redux-saga", () => ({
          call: function* (fnOrDescriptor, ...args) {
            return yield sagaEffects.call(fnOrDescriptor, ...args);
          },
        }));
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });
    const rules = new Set(result.diagnostics.map((diagnostic) => diagnostic.rule));

    expect([...rules]).toEqual(
      expect.arrayContaining([
        architectureRules.stateTypeName,
        architectureRules.selectorExportName,
        architectureRules.selectorFileName,
        architectureRules.actionTypeShape,
        architectureRules.testSelectorSelect,
        architectureRules.typedSagaCallMockGuard,
      ])
    );
  });

  it("reports non-camelCase logical slice identities without policing physical paths", async () => {
    const [validFixture, invalidFixture] = await Promise.all([
      readRuleFixture(architectureRules.camelcaseSliceIdentity, "valid"),
      readRuleFixture(architectureRules.camelcaseSliceIdentity, "invalid"),
    ]);
    const [validRoot, invalidRoot] = await Promise.all([
      createFixture({
        "src/todo-items-slice.ts": validFixture,
      }),
      createFixture({
        "src/todo-items-slice.ts": invalidFixture,
      }),
    ]);

    const [validResult, invalidResult] = await Promise.all([
      validateArchitecture({ root: validRoot, paths: ["src"] }),
      validateArchitecture({ root: invalidRoot, paths: ["src"] }),
    ]);
    const validDiagnostics = validResult.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.camelcaseSliceIdentity);
    const invalidDiagnostics = invalidResult.diagnostics.filter((diagnostic) => diagnostic.rule === architectureRules.camelcaseSliceIdentity);
    const invalidMessages = invalidDiagnostics.map((diagnostic) => diagnostic.message).join("\n");

    expect(validDiagnostics).toEqual([]);
    expect(invalidDiagnostics).toHaveLength(7);
    expect(invalidMessages).toContain('Action type namespace "todo-items" should be lowerCamelCase');
    expect(invalidMessages).toContain('Action type namespace "TodoItems" should be lowerCamelCase');
    expect(invalidMessages).toContain('Action type namespace "todo_items" should be lowerCamelCase');
    expect(invalidMessages).toContain('Store reducer-map key "todo-items" should be lowerCamelCase');
    expect(invalidMessages).toContain('Store reducer-map key "TodoItems" should be lowerCamelCase');
    expect(invalidMessages).toContain('Store reducer-map key "todo_items" should be lowerCamelCase');
  });

  it("supports rule-specific ignores for Wave 3 file-structure and test-pattern gates", async () => {
    const root = await createFixture({
      "src/legacy.ts": `
        import { createAction } from "@augmentcode/themis/utils/store/create-action";
        import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
        import { store } from "$lib/store";
        // eslint-disable-next-line architecture/state-type-name -- legacy public type rename tracked with consumer migration
        export type LegacyShape = { count: number };
        // eslint-disable-next-line architecture/state-type-name -- legacy initialState annotation kept with old public state type until v1
        const initialState: LegacyShape = { count: 0 };
        // eslint-disable-next-line architecture/action-type-shape, architecture/create-action-owner -- compatibility action stream kept until v1
        export const legacyAction = createAction("legacy/action/extra");
        // eslint-disable-next-line architecture/state-type-name -- legacy reducer generic kept with old public state type until v1
        export const legacyReducer = createReducer<LegacyShape>(initialState);
        // eslint-disable-next-line architecture/selector-export-name -- compatibility selector export kept with old module path until v1
        export const selectLegacy = store.createSelector((state) => state.legacy.count);
      `,
      "src/legacy-selectors.ts": `
        import { store } from "$lib/store";
        // eslint-disable-next-line architecture/selector-export-name -- public selector alias kept until v1
        export const legacyCount = store.createSelector((state) => state.legacy.countLabel);
      `,
      "src/legacy.test.ts": `
        import { expect, it, vi } from "vitest";
        import * as sagaEffects from "redux-saga/effects";
        import { selectLegacy } from "./legacy";
        it("keeps legacy readable call covered during migration", () => {
          const mockState = { legacy: { count: 1 } };
          // eslint-disable-next-line architecture/test-selector-select -- legacy test covers readable compatibility error separately
          expect(selectLegacy(mockState)).toBe(1);
        });
        vi.mock("typed-redux-saga", () => ({
          // eslint-disable-next-line architecture/typed-saga-call-mock-guard -- legacy mock replaced by shared test helper in follow-up
          call: function* (fnOrDescriptor, ...args) {
            return yield sagaEffects.call(fnOrDescriptor, ...args);
          },
        }));
      `,
    });

    const result = await validateArchitecture({ root, paths: ["src"] });

    expect(result.diagnostics).toEqual([]);
  });
});
