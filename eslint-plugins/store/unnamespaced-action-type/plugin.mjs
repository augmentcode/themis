import { calleeIdentifierName, staticString } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "unnamespaced-action-type";

const actionFactories = new Set(["createAction", "createAsyncAction"]);

function actionLiteralArguments(node) {
  const count = calleeIdentifierName(node) === "createAsyncAction" ? 2 : 1;
  return node.arguments
    .slice(0, count)
    .map((argument) => ({ node: argument, value: staticString(argument) }))
    .filter(({ value }) => typeof value === "string");
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Action type is missing its owning namespace.",
  why: "Unnamespaced action strings collide easily across slices and make action streams hard to audit.",
  fix: "Use exactly `sliceName/actionName` when creating actions.",
  create(_context, { report }) {
    return {
      CallExpression(node) {
        if (!actionFactories.has(calleeIdentifierName(node))) return;
        for (const literal of actionLiteralArguments(node)) {
          if (!literal.value.includes("/")) {
            report({ node: literal.node, summary: "Action type string literals should be namespaced as sliceName/actionName." });
          }
        }
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;