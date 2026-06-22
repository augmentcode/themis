import { calleeIdentifierName } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "create-action-owner";

export const rule = createArchitectureRule({
  ruleId,
  summary: "createAction call lives outside a slice owner module.",
  why: "Action creators should be colocated with the slice owner so action ownership stays discoverable with reducer state ownership.",
  fix: "Move createAction calls to a *-slice.ts, *-slice.tsx, *-slice.mts, or *-slice.cts module, or add a narrow reviewed ESLint disable during migration.",
  create(_context, { classifyPath, report }) {
    return {
      CallExpression(node) {
        if (calleeIdentifierName(node) !== "createAction") return;
        if (classifyPath().isStateOwner) return;

        report({
          node: node.callee,
          summary: "createAction(...) calls should live in slice owner modules (*-slice.ts/tsx/mts/cts).",
        });
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;