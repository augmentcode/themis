import { calleeIdentifierName, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "auto-forking-channel-helper";

const autoForkingHelpers = new Set(["takeEveryFromSelector", "takeLatestFromSelector", "takeLeadingFromSelector"]);

function autoForkingHelperArgument(node) {
  const firstArgument = unwrapExpression(node?.arguments?.[0]);
  if (firstArgument?.type !== "Identifier") return undefined;

  return autoForkingHelpers.has(firstArgument.name) ? firstArgument : undefined;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Auto-forking selector channel helper was wrapped in fork().",
  why: "takeEveryFromSelector/takeLatestFromSelector/takeLeadingFromSelector already fork workers and return a Task; wrapping them creates confusing task ownership.",
  fix: "Call the helper directly with `yield* takeLatestFromSelector(selectFoo, worker)` instead of `yield* fork(takeLatestFromSelector, ...)`.",
  create(_context, { classifyPath, report }) {
    return {
      CallExpression(node) {
        // These selector-channel helpers already fork the worker internally, so
        // wrapping them in `fork(...)` changes task ownership without benefit.
        if (!classifyPath().isSaga || calleeIdentifierName(node) !== "fork") return;

        const helper = autoForkingHelperArgument(node);
        if (!helper) return;

        report({
          node,
          summary: `${helper.name} already forks and returns a Task; call it with yield* instead of wrapping it in fork().`,
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/auto-forking-channel-helper`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};

export default plugin;
