import { calleeIdentifierName } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "selector-file-name";

const selectorFactories = new Set(["createSelector"]);

function isSelectorFactoryCall(node) {
  return node?.type === "CallExpression" && selectorFactories.has(calleeIdentifierName(node));
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Selector factory export lives outside a selector file.",
  why: "Selectors are public read APIs and should live in predictable *-selector or *-selectors modules.",
  fix: "Move exported select* selector factories to a *-selector or *-selectors file.",
  create(_context, { classifyPath, report }) {
    return {
      ExportNamedDeclaration(node) {
        if (node.declaration?.type !== "VariableDeclaration") return;
        if (/(?:^|\/)[^/]*-selectors?\.[cm]?[jt]sx?$/.test(classifyPath().path)) return;

        for (const declaration of node.declaration.declarations) {
          if (declaration.id?.type === "Identifier" && /^select[A-Z]/.test(declaration.id.name) && isSelectorFactoryCall(declaration.init)) {
            report({ node: declaration.id, summary: "Exported select* selector factories should live in *-selector or *-selectors files." });
          }
        }
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;