import { calleeIdentifierName, staticString } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "duplicate-action-type";

const actionFactories = new Set(["createAction", "createAsyncAction"]);

function reportDuplicateActionType(report, seen, actionType, node) {
  if (!actionType) return;
  if (seen.has(actionType)) {
    report({ node, summary: `Duplicate action type string "${actionType}" found in this file. Action types must be globally unique.` });
  } else {
    seen.set(actionType, node);
  }
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Action type string is duplicated across the validation scope.",
  why: "Action types must be globally unique so action ownership and saga routing stay unambiguous.",
  fix: "Rename one action type or reuse the existing action creator.",
  create(_context, { report }) {
    const seen = new Map();
    return {
      CallExpression(node) {
        const factoryName = calleeIdentifierName(node);
        if (!actionFactories.has(factoryName)) return;

        // createAsyncAction owns two action type strings; createAction owns one.
        // Looking at literal argument AST nodes keeps the standalone plugin aligned
        // with ESLint disable handling instead of re-scanning source text.
        const args = node.arguments.slice(0, factoryName === "createAsyncAction" ? 2 : 1);
        for (const argument of args) {
          reportDuplicateActionType(report, seen, staticString(argument), argument);
        }
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/duplicate-action-type`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
