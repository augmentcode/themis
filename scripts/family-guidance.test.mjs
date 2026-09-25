import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllContexts, onMount, onDestroy } from "svelte";
import * as svelteServer from "svelte/internal/server";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { signal } from "@preact/signals-react";
import * as React from "react";
import Kefir from "kefir";
import { take } from "redux-saga/effects";
import { Store } from "../src/svelte-store";
import { ReactStore } from "../src/react-store";
import { StreamingStore } from "../src/streaming-store";
import { useInitStore } from "../src/components-svelte/use-init-store";
import { useRunSaga } from "../src/components-svelte/use-run-saga";
import { createCollection, getItems } from "../src/utils/collections/collection-utils";
import { createReducer } from "../src/utils/store/create-reducer";
import { createAction } from "../src/utils/store/create-action";

const root = resolve(import.meta.dirname, "..");
const skill = (path) => readFileSync(resolve(root, path), "utf8");
const block = (path, heading, index = 0) => {
  const section = skill(path).split(heading)[1]?.split(/^## /m)[0];
  const blocks = [...(section ?? "").matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)];
  if (!blocks[index]) throw new Error(`Missing example: ${path} ${heading} #${index}`);
  return blocks[index][1];
};

// Execute the documented body, replacing only imports with real test-owned dependencies.
const execute = (source, dependencies = {}) => {
  const withoutImports = source.replace(/^import[^;]+;\n/gm, "");
  const js = ts.transpileModule(withoutImports, {
    fileName: "family-example.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports = {};
  new Function("exports", ...Object.keys(dependencies), js)(exports, ...Object.values(dependencies));
  return exports;
};

const renderComponent = (source, modules = {}, props = {}) => {
  const compiled = compile(source, { generate: "server" }).js.code;
  const js = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const dependencies = { "svelte/internal/server": svelteServer, svelte: { onMount, onDestroy }, ...modules };
  new Function("exports", "require", js)(exports, (id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected component import ${id}`);
    return dependencies[id];
  });
  return render(exports.default, { props }).body;
};

const inComponent = (onInit) => renderComponent(
  '<script>let { onInit } = $props(); onInit();</script>', {}, { onInit },
);
const counterReducer = Object.assign(
  (state = { count: 2 }, action) => action.type === "set" ? { count: action.payload } : state,
  { initialState: { count: 2 } },
);
const firstTodo = { id: "todo-1", title: "First" };
const setTodos = createAction("test/setTodos");
const todosReducer = createReducer({ collection: createCollection("id", [firstTodo]) })
  .with(setTodos, (_state, { payload: [todos] }) => ({ collection: createCollection("id", todos) }));
const cleanup = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const initializedStore = (Constructor, options) => {
  const store = new Constructor({ counter: counterReducer }, undefined, options);
  if (Constructor === Store) inComponent(() => cleanup.push(store.init()));
  else cleanup.push(store.init());
  return store;
};
const observe = (output, listener) => {
  if ("observe" in output) {
    const subscription = output.observe(listener);
    return () => subscription.unsubscribe();
  }
  return output.subscribe(listener);
};

// Type-check the actual snippet against source/public dependency signatures, not fake APIs.
// Report snippet/fixture diagnostics only: this is not a claim of a whole-repository tsc gate.
const diagnostics = (source) => {
  const file = resolve(root, "scripts/family-example.tsx");
  const fixture = resolve(root, "scripts/family-example-store.ts");
  const files = new Map([
    [file, source.replaceAll('"$lib/store"', '"./family-example-store"')],
    [fixture, `import { Store } from "@augmentcode/themis/svelte-store";
      import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
      type Project = { id: string; title: string };
      const initialState: { items: Record<string, Project> } = { items: {} };
      export const store = new Store({ projects: createReducer(initialState) });`],
  ]);
  const options = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
    baseUrl: root, paths: { "@augmentcode/themis/*": ["src/*"] },
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.readFile = (path) => files.get(path) ?? read(path);
  host.fileExists = (path) => files.has(path) || exists(path);
  host.getSourceFile = (path, version) => {
    const text = host.readFile(path);
    return text === undefined ? undefined : ts.createSourceFile(path, text, version, true);
  };
  const program = ts.createProgram([file, fixture], options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => files.has(d.file?.fileName))
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
};

const projectSelectorAssertions = `
  type Project = { id: string; title: string };
  type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
  type Assert<T extends true> = T;
  type SelectedProject = ReturnType<ReturnType<typeof createProjectSelectors>["selectProject"]["select"]>;
  type ExactProject = Assert<Same<SelectedProject, Project>>;
  type NotAny = Assert<0 extends (1 & SelectedProject) ? false : true>;
`;

describe("family skill executable and type examples", () => {
  it("F1: renders the actual root owner example with real SSR init/destroy and no mount", () => {
    const store = new Store({ counter: counterReducer });
    cleanup.push(() => store.dispose());
    const runSaga = vi.spyOn(store, "runSaga");
    const initialize = store.init.bind(store);
    let contextSize;
    vi.spyOn(store, "init").mockImplementation(() => {
      const dispose = initialize();
      contextSize = getAllContexts().size;
      expect(store.state.counter.count).toBe(2);
      return dispose;
    });
    const source = block("skills/svelte/component-integration/SKILL.md", "## Root layout wiring", 1);
    renderComponent(source, {
      "$lib/store/store": { store },
      "$lib/store/slices/counter/sagas/counter-saga": { counterSaga: function* counterSaga() {} },
    }, { children: () => {} });
    expect(contextSize).toBe(0);
    expect(runSaga).not.toHaveBeenCalled();
    expect(() => store.state).toThrow(/before Store.init/);
  });

  it("F1: useInitStore does not provide context; standalone Svelte init remains unsupported", () => {
    const store = new Store({});
    cleanup.push(() => store.dispose());
    expect(() => store.init()).toThrow(/outside component initialization/);
    const started = vi.fn();
    inComponent(() => {
      useInitStore(store);
      expect(getAllContexts().size).toBe(0);
      useRunSaga(function* exampleSaga() { started(); });
      expect(started).not.toHaveBeenCalled();
    });
    expect(() => store.state).toThrow(/before Store.init/);
  });

  it("F1/F2: the documented mount callback returns real saga cancellation; direct reads need no context", () => {
    const store = new Store({ counter: counterReducer });
    const selectCount = store.createSelector((state) => state.counter.count);
    expect(() => selectCount()).toThrow(/before Store.init/);
    inComponent(() => cleanup.push(store.init()));
    const values = [];
    cleanup.push(selectCount().subscribe((value) => values.push(value)));
    expect(values).toEqual([2]);
    const started = vi.fn(), stopped = vi.fn();
    function* counterSaga() {
      started();
      try { yield take("never"); } finally { stopped(); }
    }
    const source = block("skills/svelte/component-integration/SKILL.md", "## Root layout wiring", 1);
    const callback = source.match(/onMount\((\(\) => store\.runSaga\(counterSaga\))\);/)?.[1];
    expect(callback).toBeDefined();
    const mount = new Function("store", "counterSaga", `return (${callback});`)(store, counterSaga);
    const cancel = mount();
    expect(started).toHaveBeenCalledTimes(1);
    cancel();
    expect(stopped).toHaveBeenCalledTimes(1);
    const cancelAgain = mount();
    expect(started).toHaveBeenCalledTimes(2);
    cancelAgain();
    store.dispose();
    expect(() => selectCount()).toThrow(/before Store.init/);
  });

  it("F4: preserves configured Store state in the shared Svelte selector helper", () => {
    const source = block("skills/svelte/selectors/SKILL.md", "### 5. Pass a configured Store");
    expect(diagnostics(source + projectSelectorAssertions)).toEqual([]);
    const { createProjectSelectors } = execute(source);
    const store = new Store({ projects: createReducer({ items: {} }) });
    const { selectProject } = createProjectSelectors(store);
    const project = { id: "a", title: "First" };
    expect(selectProject.select({ projects: { items: { a: project } } }, "a")).toBe(project);
    expect(selectProject.select({ projects: { items: {} } }, "missing")).toBeUndefined();
  });

  it("F4: rejects the original bare Store annotation in the actual helper", () => {
    const source = block("skills/svelte/selectors/SKILL.md", "### 5. Pass a configured Store");
    const bareStore = source
      .replace('import type { store as appStore } from "$lib/store";', 'import type { Store } from "@augmentcode/themis/svelte-store";')
      .replace("store: typeof appStore", "store: Store");
    expect(bareStore).not.toBe(source);
    expect(diagnostics(bareStore)).toEqual([expect.stringMatching(/^TS2339: Property 'projects' does not exist/)]);
  });

  it("F4: exact output assertions reject any even when the helper compiles", () => {
    const source = block("skills/svelte/selectors/SKILL.md", "### 5. Pass a configured Store");
    const anyOutput = source.replace("selectProjects.select(state)[id]", "(selectProjects.select(state)[id] as any)");
    expect(anyOutput).not.toBe(source);
    expect(diagnostics(anyOutput)).toEqual([]);
    expect(diagnostics(anyOutput + projectSelectorAssertions)).toEqual([
      expect.stringMatching(/^TS2344: Type 'false' does not satisfy the constraint 'true'/),
      expect.stringMatching(/^TS2344: Type 'false' does not satisfy the constraint 'true'/),
    ]);
  });

  it("F5: type-checks the actual local signal effect callback", () => {
    const source = block("skills/react/signals/SKILL.md", "## Component-local signals");
    // Installed tooling has no React JSX types. Check the actual hooks/effect body,
    // excluding only the unrelated input JSX; do not stub the effect signature.
    expect(diagnostics(source.replace(/^  return <input.*$/m, ""))).toEqual([]);
  });

  it("F6: executes migrated cart selectors against canonical Collections", () => {
    const path = "skills/react/migration/derived-stores/SKILL.md";
    const reactStore = new ReactStore({ cart: createReducer({ collection: createCollection("id"), discountCode: null }) });
    cleanup.push(() => reactStore.dispose());
    const selectors = execute(block(path, "## After: Store-bound selectors"), { reactStore, getItems });
    for (const [items, discountCode, expected] of [
      [[], null, 0], [[{ id: "a", price: 10 }], null, 10],
      [[{ id: "a", price: 10 }, { id: "b", price: 20 }], "SAVE", 27],
    ]) {
      const state = { cart: { collection: createCollection("id", items), discountCode } };
      expect(selectors.selectCartItems.select(state)).toEqual(items);
      expect(selectors.selectCartTotal.select(state)).toBe(expected);
    }
    expect(() => reactStore.state).toThrow(/before Store.init/);
  });

  it.each([false, true])("F6: the documented test owns init/read/dispose, including assertion failure=%s", (failAssertion) => {
    const path = "skills/react/migration/derived-stores/SKILL.md";
    const reactStore = new ReactStore({
      cart: createReducer({ collection: createCollection("id"), discountCode: null }),
      counter: counterReducer,
    });
    cleanup.push(() => reactStore.dispose());
    const init = vi.spyOn(reactStore, "init"), dispose = vi.spyOn(reactStore, "dispose");
    const state = vi.spyOn(reactStore, "state", "get");
    const selectors = execute(block(path, "## After: Store-bound selectors"), { reactStore, getItems });
    const selectTotal = vi.spyOn(selectors.selectCartTotal, "select");
    const register = vi.fn();
    const failure = new Error("forced documented assertion failure");
    const documentedExpect = vi.fn(failAssertion ? () => { throw failure; } : expect);
    execute(block(path, "## Component and test consumption", 1), {
      ...selectors, reactStore, createCollection, it: register, expect: documentedExpect,
    });
    expect(register).toHaveBeenCalledTimes(1);
    expect(init).not.toHaveBeenCalled();
    expect(state).not.toHaveBeenCalled();
    expect(selectTotal).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();

    const [, test] = register.mock.calls[0];
    if (failAssertion) expect(test).toThrow(failure);
    else test();
    expect(documentedExpect).toHaveBeenCalledExactlyOnceWith(10);
    expect(init).toHaveBeenCalledTimes(1);
    expect(state).toHaveBeenCalledTimes(1);
    expect(selectTotal).toHaveBeenCalledTimes(1);
    expect(selectTotal.mock.calls[0][0].counter).toEqual({ count: 2 });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(init.mock.invocationCallOrder[0]).toBeLessThan(state.mock.invocationCallOrder[0]);
    expect(selectTotal.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]);
    expect(() => reactStore.state).toThrow(/before Store.init/);
  });

  it("React lifecycle: the root adapter initializes before saga/render and cancels before disposal", () => {
    const reactStore = new ReactStore({ counter: counterReducer });
    cleanup.push(() => reactStore.dispose());
    const init = vi.spyOn(reactStore, "init"), dispose = vi.spyOn(reactStore, "dispose");
    const started = vi.fn(), stopped = vi.fn();
    function* todosSaga() {
      started(reactStore.state.counter.count);
      try { yield take("never"); } finally { stopped(reactStore.state.counter.count); }
    }
    let cancel;
    const run = reactStore.runSaga.bind(reactStore);
    const runSaga = vi.spyOn(reactStore, "runSaga").mockImplementation((saga) => {
      cancel = vi.fn(run(saga));
      return cancel;
    });
    // Stub React's root boundary only; the Store, JSX element, and saga are real.
    const render = vi.fn(() => expect(reactStore.state.counter.count).toBe(2));
    const unmount = vi.fn(() => expect(reactStore.state.counter.count).toBe(2));
    const createRoot = vi.fn(() => ({ render, unmount }));
    const App = () => null;
    const { mountReactApp } = execute(block("skills/react/component-integration/SKILL.md", "## Dispose at the same owner boundary"), {
      React, createRoot, App, reactStore, todosSaga,
    });
    expect(createRoot).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
    expect(runSaga).not.toHaveBeenCalled();
    expect(() => reactStore.state).toThrow(/before Store.init/);

    const container = {};
    const teardown = mountReactApp(container);
    expect(createRoot).toHaveBeenCalledExactlyOnceWith(container);
    expect(init).toHaveBeenCalledTimes(1);
    expect(runSaga).toHaveBeenCalledExactlyOnceWith(todosSaga);
    expect(started).toHaveBeenCalledExactlyOnceWith(2);
    expect(render).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: App }));
    expect(init.mock.invocationCallOrder[0]).toBeLessThan(runSaga.mock.invocationCallOrder[0]);
    expect(runSaga.mock.invocationCallOrder[0]).toBeLessThan(render.mock.invocationCallOrder[0]);
    expect(cancel).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();

    teardown();
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stopped).toHaveBeenCalledExactlyOnceWith(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(unmount.mock.invocationCallOrder[0]).toBeLessThan(cancel.mock.invocationCallOrder[0]);
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]);
    expect(stopped.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]);
    expect(() => reactStore.state).toThrow(/before Store.init/);
  });

  it("React lifecycle: a component/layout owner cancels on unmount and remounts without disposing the parent Store", () => {
    const path = "skills/react/migration/side-effects/SKILL.md";
    const guidance = skill(path).replace(/\s+/g, " ");
    expect(guidance).toContain("**App-wide work:** start from the existing React bootstrap/root or service owner after Store initialization");
    expect(guidance).toContain("**Component/layout-scoped work:** start when that component/layout mounts");
    expect(guidance).toContain("the scoped owner must not initialize or dispose the parent's Store");
    expect(guidance).toContain("Do not also start the same saga at the root or in another concurrent owner");
    const reactStore = new ReactStore({ counter: counterReducer });
    cleanup.push(() => reactStore.dispose());
    const init = vi.spyOn(reactStore, "init"), dispose = vi.spyOn(reactStore, "dispose");
    const runSaga = vi.spyOn(reactStore, "runSaga");
    const started = vi.fn(), stopped = vi.fn();
    function* usersSaga() {
      started(reactStore.state.counter.count);
      try { yield take("never"); } finally { stopped(reactStore.state.counter.count); }
    }
    // Capture the documented effect without pretending to exercise React scheduling.
    const useEffect = vi.fn();
    const { UsersRuntime } = execute(block(path, "## Start the saga from ReactStore setup"), { useEffect, reactStore, usersSaga });
    expect(init).not.toHaveBeenCalled();
    expect(runSaga).not.toHaveBeenCalled();
    expect(useEffect).not.toHaveBeenCalled();
    const disposeParent = reactStore.init();
    for (let mount = 1; mount <= 2; mount++) {
      UsersRuntime();
      expect(useEffect).toHaveBeenCalledTimes(mount);
      expect(runSaga).toHaveBeenCalledTimes(mount - 1);
      const [effect, dependencies] = useEffect.mock.calls.at(-1);
      expect(dependencies).toEqual([]);
      const cancel = effect();
      expect(runSaga).toHaveBeenLastCalledWith(usersSaga);
      expect(cancel).toBe(runSaga.mock.results.at(-1).value);
      expect(started).toHaveBeenCalledTimes(mount);
      expect(init).toHaveBeenCalledTimes(1);
      cancel();
      expect(stopped).toHaveBeenCalledTimes(mount);
      expect(stopped).toHaveBeenLastCalledWith(2);
      expect(dispose).not.toHaveBeenCalled();
      expect(reactStore.state.counter.count).toBe(2);
    }
    disposeParent();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(stopped).toHaveBeenCalledTimes(2);
    expect(() => reactStore.state).toThrow(/before Store.init/);
  });

  it("F7: empty bootstrap evidence excludes reserved composed reducers", () => {
    const source = block("skills/svelte/migration/setup/SKILL.md", "### 5. Prove empty bootstrap");
    expect(Object.keys(new Store({}).getReducers()).sort()).toEqual(["@internal_sagaManager", "@internal_storeUtility"]);
    expect(execute(source, { Store }).emptyBootstrapEvidence.reducerDomainsVisibleToApp).toEqual([]);
    const migratedSource = source.replace("new Store({})", "new Store({ counter: counterReducer })");
    expect(execute(migratedSource, { Store, counterReducer }).emptyBootstrapEvidence.reducerDomainsVisibleToApp).toEqual(["counter"]);
  });

  it("FAM-1: the React direct-selector fence initializes a live signal until app-owned teardown", () => {
    vi.useFakeTimers();
    const init = vi.spyOn(ReactStore.prototype, "init");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const source = block("docs/SELECTORS.md", "### 2. In React components and signal-aware code");
    // Execute the exact fence except its unrelated JSX return. No React render/typecheck claim.
    // The harness supplies a real reducer, never an initialized Store or an injected init().
    const { reactStore, selectTodoById, todoSignal, disposeReactStore, TodoTitle } = execute(
      source.replace(/^  return <span.*$/m, "") + "\nexport { todoSignal };",
      { ReactStore, todosReducer },
    );
    cleanup.push(() => reactStore.dispose());
    const dispose = vi.spyOn(reactStore, "dispose");
    expect(init).toHaveBeenCalledTimes(1);
    expect(typeof TodoTitle).toBe("function");
    expect(reactStore.state.todos.collection.map["todo-1"]).toEqual(firstTodo);
    expect(todoSignal.value).toEqual(firstTodo);
    expect(selectTodoById("todo-1")).toBe(todoSignal);
    expect(log.mock.calls).toEqual([[firstTodo]]);

    const values = [];
    const unsubscribe = todoSignal.subscribe((todo) => values.push(todo.title));
    cleanup.push(unsubscribe);
    reactStore.dispatch(setTodos([{ ...firstTodo, title: "Updated" }]));
    vi.advanceTimersByTime(0);
    expect(todoSignal.value.title).toBe("Updated");
    expect(values).toEqual(["First", "Updated"]);
    expect(dispose).not.toHaveBeenCalled();

    reactStore.dispatch(setTodos([{ ...firstTodo, title: "Pending" }]));
    unsubscribe(); // Manual consumer stops before the application disposes its shared Store.
    disposeReactStore();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => selectTodoById("todo-1")).toThrow(/before Store.init/);
    expect(vi.getTimerCount()).toBe(0);
    expect(values).toEqual(["First", "Updated"]);
  });

  it("FAM-1: the Streaming direct-selector fence emits values and unsubscribes before disposal", () => {
    vi.useFakeTimers();
    const init = vi.spyOn(StreamingStore.prototype, "init");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const source = block("docs/SELECTORS.md", "### 6. Streaming Store selectors");
    const { streamStore, selectTodoCountStream, todoCount$, subscription, disposeStreamingExample } = execute(
      source + "\nexport { todoCount$, subscription };", { StreamingStore, todosReducer },
    );
    cleanup.push(disposeStreamingExample);
    const dispose = vi.spyOn(streamStore, "dispose");
    const unsubscribe = vi.spyOn(subscription, "unsubscribe");
    expect(init).toHaveBeenCalledTimes(1);
    expect(selectTodoCountStream()).toBe(todoCount$);
    expect(log.mock.calls).toEqual([[1]]);

    streamStore.dispatch(setTodos([firstTodo, { id: "todo-2", title: "Second" }]));
    vi.advanceTimersByTime(0);
    expect(log.mock.calls).toEqual([[1], [2]]);
    expect(dispose).not.toHaveBeenCalled();
    streamStore.dispatch(setTodos([]));
    disposeStreamingExample();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]);
    expect(() => selectTodoCountStream()).toThrow(/before Store.init/);
    expect(vi.getTimerCount()).toBe(0);
    expect(log.mock.calls).toEqual([[1], [2]]);
  });

  it.each(["React", "Streaming"])("F3: %s documentation separates argument emissions from state cadence", (family) => {
    vi.useFakeTimers();
    const store = initializedStore(family === "React" ? ReactStore : StreamingStore, { throttledSelectorFrequency: 1 });
    const source = block("docs/SELECTORS.md", "#### Reactive arguments versus Store-state ticks", family === "React" ? 0 : 1);
    const { selectScaled, factor, scaled } = execute(source, { reactStore: store, streamStore: store, signal, Kefir });
    const values = [];
    cleanup.push(observe(scaled, (value) => values.push(value)));
    const setFactor = (value) => family === "React" ? factor.value = value : factor.plug(Kefir.constant(value));
    if (family === "Streaming") {
      expect(values).toEqual([]); // Cold observable argument has no current value.
      setFactor(3);
    }
    expect(values).toEqual([6]);
    setFactor(4);
    setFactor(5);
    setFactor(5); // Unchanged selected value is not emitted again.
    expect(values).toEqual([6, 8, 10]);
    expect(vi.getTimerCount()).toBe(0);
    store.dispatch({ type: "set", payload: 3 });
    store.dispatch({ type: "set", payload: 4 });
    expect(values).toEqual([6, 8, 10]);
    expect(selectScaled.select(store.state, 5)).toBe(20); // One-shot read is uncadenced.
    vi.advanceTimersByTime(0);
    expect(values).toEqual([6, 8, 10, 20]);
    store.dispatch({ type: "set", payload: 5 });
    store.dispatch({ type: "set", payload: 6 });
    setFactor(6); // Uses the last emitted state (4), not the pending state (6).
    expect(values.at(-1)).toBe(24);
    vi.advanceTimersByTime(999);
    expect(values.at(-1)).toBe(24);
    vi.advanceTimersByTime(1);
    expect(values.at(-1)).toBe(36);
    store.dispatch({ type: "set", payload: 7 });
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([Store, ReactStore, StreamingStore])("F8: %s cache identity ends at final consumer cleanup, not first", (Constructor) => {
    const store = initializedStore(Constructor);
    const selectCount = store.createSelector((state, offset) => state.counter.count + offset);
    const output = selectCount(0);
    expect(selectCount(0)).toBe(output); // Never observed is cached as documented.
    const otherKey = selectCount(1);
    const stopA = observe(output, () => {}), stopB = observe(output, () => {});
    cleanup.push(stopA, stopB);
    expect(selectCount(0)).toBe(output);
    stopA();
    expect(selectCount(0)).toBe(output);
    stopB();
    const replacement = selectCount(0);
    expect(replacement).not.toBe(output);
    expect(selectCount(1)).toBe(otherKey); // Output-scoped eviction, not all arguments.
    store.dispose();
    if (Constructor === Store) inComponent(() => store.init());
    else store.init();
    expect(selectCount(0)).not.toBe(replacement);
    expect(selectCount(1)).not.toBe(otherKey);
  });

  it("F9: the documented binding uses a Store object, not its internal Kefir stream", () => {
    const first = initializedStore(StreamingStore);
    const second = initializedStore(StreamingStore);
    const selectTodoById = first.createSelector((state, id) => `${id}:${state.counter.count}`);
    const source = block("docs/SELECTORS.md", "### 5. Bound to a Store") + "\nexport { todo };";
    const bind = (store) => execute(source, { store, selectTodoById, todoId: "a" }).todo;
    const a = bind(first);
    expect(bind(first)).toBe(a);
    vi.spyOn(second, "getStoreStateStream").mockReturnValue(first.getStoreStateStream());
    const b = bind(second);
    expect(b).not.toBe(a); // Same internal stream does not merge Store-object keys.
    const values = [];
    cleanup.push(observe(b, (value) => values.push(value)));
    expect(values).toEqual(["a:2"]);
    expect(() => bind(Kefir.constant(first.state))).toThrow(/getStoreStateStream/);
    const sourceTypes = `import { StreamingStore } from "@augmentcode/themis/streaming-store";
      import Kefir from "kefir";
      const store = new StreamingStore({});
      const selectCount = store.createSelector(() => 1);
      selectCount.withStore(store);
      selectCount.withStore(Kefir.constant({}));`;
    expect(diagnostics(sourceTypes)).toEqual([expect.stringMatching(/^TS2345:.*not assignable/)]);
  });
});