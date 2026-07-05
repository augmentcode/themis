import { createImportedSelectorTracker, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "direct-selector-call-mode";

export const rule = createArchitectureRule({
  ruleId,
  summary: "Selector readable form was called from an unsafe callback or function context.",
  why: "Bare `selectFoo()` creates a Svelte readable using component context and is only safe during component initialization.",
  fix: "Use `selectFoo.select(store.state, args)` in callbacks/tests or `yield* selectFoo.effect(args)` in sagas; reserve `selectFoo()` for component init.",
  create(_context, { classifyPath, report }) {
    const selectorImports = createImportedSelectorTracker();
    let functionDepth = 0;

    function enterFunction() {
      functionDepth += 1;
    }

    function exitFunction() {
      functionDepth -= 1;
    }

    return {
      ImportDeclaration: selectorImports.recordImportDeclaration,
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      CallExpression(node) {
        if (classifyPath().isReactComponent) return;

        // Bare readable selectors are only safe while a component initializes.
        // Any nested function/callback may run later and must use an explicit mode.
        if (functionDepth === 0) return;

        const callee = unwrapExpression(node.callee);
        if (!selectorImports.isImportedSelectorIdentifier(callee)) return;

        report({
          node: callee,
          summary: "Bare selectFoo() creates a Svelte readable and is only safe at component init; use selectFoo.select(state) in callbacks/handlers or selectFoo.effect() in sagas.",
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/direct-selector-call-mode`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};

export default plugin;
