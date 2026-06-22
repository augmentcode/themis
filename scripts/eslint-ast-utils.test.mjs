import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import { createImportedSelectorTracker, isSelectorModuleImportSource } from "../eslint-plugins/ast-utils.mjs";

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