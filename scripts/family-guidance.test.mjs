import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllContexts, onMount, onDestroy } from "svelte";
import * as svelteServer from "svelte/internal/server";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { signal } from "@preact/signals-react";
import Kefir from "kefir";
import { take } from "redux-saga/effects";
import { Store } from "../src/svelte-store";
import { ReactStore } from "../src/react-store";
import { StreamingStore } from "../src/streaming-store";
import { useInitStore } from "../src/components-svelte/use-init-store";
import { useRunSaga } from "../src/components-svelte/use-run-saga";
import { createCollection, getItems } from "../src/utils/collections/collection-utils";
import { createReducer } from "../src/utils/store/create-reducer";

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
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
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
    const reactStore = new ReactStore({ cart: (state = { collection: createCollection("id"), discountCode: null }) => state });
    const dispose = reactStore.init();
    try {
      const selectors = execute(block(path, "## After: Store-bound selectors"), { reactStore, getItems });
      for (const [items, discountCode, expected] of [
        [[], null, 0], [[{ id: "a", price: 10 }], null, 10],
        [[{ id: "a", price: 10 }, { id: "b", price: 20 }], "SAVE", 27],
      ]) {
        const state = { ...reactStore.state, cart: { collection: createCollection("id", items), discountCode } };
        expect(selectors.selectCartItems.select(state)).toEqual(items);
        expect(selectors.selectCartTotal.select(state)).toBe(expected);
      }
      const example = execute(block(path, "## Component and test consumption", 1), {
        ...selectors, reactStore, createCollection,
      });
      expect(example.total).toBe(10);
    } finally {
      dispose();
    }
  });

  it("F7: empty bootstrap evidence excludes reserved composed reducers", () => {
    const source = block("skills/svelte/migration/setup/SKILL.md", "### 5. Prove empty bootstrap");
    expect(Object.keys(new Store({}).getReducers()).sort()).toEqual(["@internal_sagaManager", "@internal_storeUtility"]);
    expect(execute(source, { Store }).emptyBootstrapEvidence.reducerDomainsVisibleToApp).toEqual([]);
    const migratedSource = source.replace("new Store({})", "new Store({ counter: counterReducer })");
    expect(execute(migratedSource, { Store, counterReducer }).emptyBootstrapEvidence.reducerDomainsVisibleToApp).toEqual(["counter"]);
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