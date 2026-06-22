import { calleeIdentifierName, isCallNamed } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "duplicate-selector-implementation";

const selectorFactories = new Set(["createSelector", "createCollectionItemSelector", "createCollectionItemsListSelector"]);

function selectorBody(sourceCode, node) {
  const firstArg = node.arguments[0];
  if (!firstArg) return undefined;

  // Selector implementation identity intentionally normalizes the first selector
  // input expression from source text because the duplicate check compares bodies,
  // not node identity. Comments and whitespace are removed for stable diagnostics.
  return `${calleeIdentifierName(node)}:${sourceCode
    .getText(firstArg)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, "")
    .replace(/;$/, "")}`;
}

function reportDuplicateSelectorImplementation(report, seen, key, node) {
  if (!key) return;
  if (seen.has(key)) report({ node, summary: "Duplicate selector implementation found in this file. Reuse the existing selector or make the derivation distinct." });
  else seen.set(key, node);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Selector implementation is duplicated across the validation scope.",
  why: "Duplicated selector bodies split ownership of the same state derivation.",
  fix: "Reuse the existing selector or make the derivation distinct.",
  create(_context, { report, sourceCode }) {
    const seen = new Map();
    return {
      CallExpression(node) {
        if (!isCallNamed(node, selectorFactories)) return;
        reportDuplicateSelectorImplementation(report, seen, selectorBody(sourceCode, node), node);
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/duplicate-selector-implementation`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
