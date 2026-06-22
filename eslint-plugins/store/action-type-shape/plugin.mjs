import { calleeIdentifierName, staticString } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "action-type-shape";

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
  summary: "Action type string literal has an invalid namespace shape.",
  why: "Action strings should have one owning namespace so reducers and sagas can audit ownership without collisions.",
  fix: "Use exactly one non-empty namespace segment: sliceName/actionName.",
  create(_context, { report }) {
    return {
      CallExpression(node) {
        if (!actionFactories.has(calleeIdentifierName(node))) return;

        for (const literal of actionLiteralArguments(node)) {
          const segments = literal.value.split("/");
          if (segments.length <= 1 || (segments.length === 2 && segments.every(Boolean))) continue;
          report({
            node: literal.node,
            summary: "Action type string literals should use exactly one non-empty namespace segment: sliceName/actionName.",
          });
        }
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;