import { memberPropertyName, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "async-reducer-handler";

function isReducerFile(path) {
  return /(?:^|\/)[^/]*(?:reducer|slice)\.[cm]?[jt]sx?$/.test(path) || /(?:^|\/)[^/]*-slice\.[cm]?[jt]sx?$/.test(path);
}

function reducerHandlerArgument(node) {
  const callee = unwrapExpression(node.callee);
  if (callee?.type !== "MemberExpression" || memberPropertyName(callee) !== "with") return undefined;
  return unwrapExpression(node.arguments[1]);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Reducer handler is asynchronous.",
  why: "Reducer updates must complete synchronously so dispatch order, subscribers, and state snapshots stay predictable.",
  fix: "Move async work into a saga and dispatch a follow-up action with the resolved data.",
  create(_context, { classifyPath, report }) {
    return {
      CallExpression(node) {
        if (!isReducerFile(classifyPath().path)) return;

        // The reducer builder API passes the handler as the second `.with(...)` argument.
        const handler = reducerHandlerArgument(node);
        if (!handler?.async) return;

        report({
          node: handler,
          summary: "Reducer handlers must be synchronous and pure; move async work into sagas or action preparation.",
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/async-reducer-handler`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
