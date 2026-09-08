import { parse } from "@babel/parser";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import {
  createImportedSelectorTracker,
  createStoreCreateSelectorTracker,
  isSelectorModuleImportSource,
} from "../eslint-plugins/ast-utils.mjs";

function parseModule(source) {
  return parse(source, { sourceType: "module", plugins: ["estree", "typescript"] }).program;
}

function createTracker(source) {
  const program = parseModule(source);
  const tracker = createImportedSelectorTracker();

  for (const node of program.body) {
    if (node.type === "ImportDeclaration") tracker.recordImportDeclaration(node);
  }

  return { program, tracker };
}

function callExpressionByName(program, name) {
  return program.body.find((node) => node.type === "ExpressionStatement" && node.expression?.callee?.name === name)?.expression;
}

function storeCreateSelectorCalls(source) {
  const calls = [];
  const parser = {
    meta: { name: "local-babel-ts-parser" },
    parseForESLint(code) {
      const ast = parse(code, { sourceType: "module", plugins: ["estree", "typescript"], ranges: true, tokens: true });
      ast.tokens = ast.tokens.map((token) => ({ type: token.type.label, value: String(token.value ?? code.slice(token.start, token.end)), loc: token.loc, range: [token.start, token.end] }));
      return { ast };
    },
  };
  const rule = {
    meta: { schema: [] },
    create(context) {
      const tracker = createStoreCreateSelectorTracker(context.sourceCode);
      return {
        CallExpression(node) {
          if (tracker.isStoreCreateSelectorCall(node)) calls.push(context.sourceCode.getText(node));
        },
      };
    },
  };
  const messages = new Linter().verify(source, [{ languageOptions: { parser }, plugins: { test: { rules: { provenance: rule } } }, rules: { "test/provenance": "error" } }]);
  expect(messages).toEqual([]);
  return calls;
}

describe("ESLint imported selector AST helpers", () => {
  it("matches selector module import sources with optional extensions", () => {
    expect(isSelectorModuleImportSource("../todos/todos-selectors")).toBe(true);
    expect(isSelectorModuleImportSource("../../slices/todos/todos-selectors.ts")).toBe(true);
    expect(isSelectorModuleImportSource("@app/domain/user/user-selectors.mjs")).toBe(true);
    expect(isSelectorModuleImportSource("../todos-selectors")).toBe(false);
    expect(isSelectorModuleImportSource("./ready-selector.ts")).toBe(false);
    expect(isSelectorModuleImportSource("../selector-channel-effects")).toBe(false);
    expect(isSelectorModuleImportSource("../utils/svelte-selectors/create-selector")).toBe(false);
    expect(isSelectorModuleImportSource("../utils/selector-core/create-cached-selector")).toBe(false);
    expect(isSelectorModuleImportSource("../utils/sagas/selector-channel-effects")).toBe(false);
    expect(isSelectorModuleImportSource("../todos")).toBe(false);
  });

  it("tracks runtime named selector imports by local callee identifier", () => {
    const { program, tracker } = createTracker(`
      import { selectTodos, selectDone as readDone, createSelector } from "../todos/todos-selectors";
      import { selectReady as isReady } from "../../slices/ready/ready-selectors.ts";
      import type { selectTypeOnly } from "../type/type-selectors";
      import { type selectInlineType, selectRuntime } from "../mixed/mixed-selectors";
      import { selectOther } from "../other";
      import { selectUtility } from "../utils/svelte-selectors/create-selector";
      import { selectCached } from "../utils/selector-core/create-cached-selector";
      import { selectChannel } from "../utils/sagas/selector-channel-effects";
      import * as selectorNamespace from "../todos/todos-selectors";
      import defaultSelector from "../todos/todos-selectors";

      function selectLocal() {}
      selectTodos(state);
      readDone(state);
      isReady(state);
      createSelector(state);
      selectRuntime(state);
      selectTypeOnly(state);
      selectInlineType(state);
      selectOther(state);
      selectUtility(state);
      selectCached(state);
      selectChannel(state);
      selectorNamespace.selectTodos(state);
      defaultSelector(state);
      selectLocal(state);
    `);

    expect([...tracker.importedSelectorLocals].sort()).toEqual(["isReady", "readDone", "selectRuntime", "selectTodos"]);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "selectTodos"))).toBe(true);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "readDone"))).toBe(true);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "selectRuntime"))).toBe(true);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "createSelector"))).toBe(false);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "selectTypeOnly"))).toBe(false);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "selectInlineType"))).toBe(false);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "selectOther"))).toBe(false);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "selectUtility"))).toBe(false);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "selectCached"))).toBe(false);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "selectChannel"))).toBe(false);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "defaultSelector"))).toBe(false);
    expect(tracker.isImportedSelectorCallee(callExpressionByName(program, "selectLocal"))).toBe(false);
  });
});

describe("ESLint Store createSelector provenance helper", () => {
  it("recognizes Store instance member calls from supported aliased imports", () => {
    expect(storeCreateSelectorCalls(`
      import { Store as SvelteStore } from "@augmentcode/themis/svelte-store";
      import { ReactStore as SignalsStore } from "@augmentcode/themis/react-store";
      import { StreamingStore } from "@augmentcode/themis/streaming-store";
      const svelte = new SvelteStore();
      const react = new SignalsStore();
      const streaming = new StreamingStore();
      svelte.createSelector(callback);
      react["createSelector"](callback);
      (streaming as StreamingStore)[\`createSelector\`](callback);
    `)).toEqual([
      "svelte.createSelector(callback)",
      'react["createSelector"](callback)',
      "(streaming as StreamingStore)[`createSelector`](callback)",
    ]);
  });

  it("recognizes direct, destructured, computed, and chained local aliases", () => {
    expect(storeCreateSelectorCalls(`
      import { Store } from "@augmentcode/themis/svelte-store";
      const store = new Store();
      const makeSelector = store.createSelector;
      const { createSelector } = store;
      const { ["createSelector"]: buildSelector } = store;
      const alias = buildSelector;
      makeSelector(callback);
      createSelector(callback);
      buildSelector(callback);
      alias(callback);
    `)).toEqual([
      "makeSelector(callback)",
      "createSelector(callback)",
      "buildSelector(callback)",
      "alias(callback)",
    ]);
  });

  it("rejects utilities, unrelated objects, dynamic properties, and shadowed bindings", () => {
    expect(storeCreateSelectorCalls(`
      import { Store } from "@augmentcode/themis/svelte-store";
      import { ReactStore } from "@augmentcode/themis/svelte-store";
      import { createSelector } from "../utils/selector-core/create-cached-selector";
      const store = new Store();
      const wrongStore = new ReactStore();
      const method = "createSelector";
      const unrelated = { createSelector() {} };
      const local = unrelated.createSelector;
      createSelector(callback);
      wrongStore.createSelector(callback);
      unrelated.createSelector(callback);
      store[method](callback);
      local(callback);
      function nested(store, createSelector) {
        store.createSelector(callback);
        createSelector(callback);
      }
    `)).toEqual([]);
  });
});