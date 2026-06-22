import { calleeIdentifierName, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "inline-saga-selector";

function isInlineSelectorFunction(node) {
  const current = unwrapExpression(node);
  return current?.type === "ArrowFunctionExpression" || current?.type === "FunctionExpression";
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Saga selected state with an inline selector callback.",
  why: "Inline selectors are anonymous, bypass the named selector contract, and lose shared memoization and typed selector effect helpers.",
  fix: "Move the state read into a named `select*` selector and call `yield* selectFoo.effect(args)` from the saga.",
  create(_context, { classifyPath, report }) {
    return {
      CallExpression(node) {
        // Only saga-local typed-redux-saga `select(...)` calls participate in
        // the selector channel contract; other callbacks are handled elsewhere.
        if (!classifyPath().isSaga || calleeIdentifierName(node) !== "select") return;
        if (!isInlineSelectorFunction(node.arguments[0])) return;

        report({
          node: node.arguments[0],
          summary: "Inline saga selectors are anonymous and bypass named selector caching; create a selector and call selectFoo.effect() instead.",
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/inline-saga-selector`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};

export default plugin;
