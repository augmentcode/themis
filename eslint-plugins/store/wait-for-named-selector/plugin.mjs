import { calleeIdentifierName, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "wait-for-named-selector";

function isInlineSelectorFunction(node) {
  const current = unwrapExpression(node);
  return current?.type === "ArrowFunctionExpression" || current?.type === "FunctionExpression";
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "waitFor received an inline selector callback.",
  why: "waitFor subscribes through the named selector channel contract so selector arguments, memoization, and cleanup remain explicit.",
  fix: "Create a named selector with `store.createSelector` and call `yield* waitFor(selectFoo, args, predicate, timeoutMs)`.",
  create(_context, { classifyPath, report }) {
    return {
      CallExpression(node) {
        // `waitFor` should subscribe through the named selector object so the
        // channel helper can handle arguments, memoization, and cleanup.
        if (!classifyPath().isSaga || calleeIdentifierName(node) !== "waitFor") return;
        if (!isInlineSelectorFunction(node.arguments[0])) return;

        report({
          node: node.arguments[0],
          summary: "waitFor must receive a named selector created by createSelector; inline selector lambdas are not supported.",
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/wait-for-named-selector`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};

export default plugin;
