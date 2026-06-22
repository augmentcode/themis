import { calleeIdentifierName } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "selector-export-name";

const selectorFactories = new Set(["createSelector", "createCollectionItemSelector", "createCollectionItemsListSelector"]);

function isSelectorFactoryCall(node) {
  return node?.type === "CallExpression" && selectorFactories.has(calleeIdentifierName(node));
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Selector factory export name does not start with select.",
  why: "Selector naming makes `.select` and `.effect` usage discoverable at call sites.",
  fix: "Rename selector exports in selector files to start with select.",
  create(_context, { report }) {
    return {
      ExportNamedDeclaration(node) {
        if (node.declaration?.type !== "VariableDeclaration") return;
        for (const declaration of node.declaration.declarations) {
          if (isSelectorFactoryCall(declaration.init) && declaration.id?.type === "Identifier" && !declaration.id.name.startsWith("select")) {
            report({ node: declaration.id, summary: "Selector factory exports in selector files should start with select." });
          }
        }
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;