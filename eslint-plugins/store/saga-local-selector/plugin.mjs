import { createStoreCreateSelectorTracker } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "saga-local-selector";

function isSelectorIdentifier(node) {
  return node?.type === "Identifier" && /^select[A-Z]/.test(node.name);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Saga module defines a selector locally instead of importing it from a [slice]-selectors file.",
  why: "Saga-local selectors duplicate read APIs, bypass shared memoization, and prevent reuse from components and other sagas.",
  fix: "Move the selector into the slice's [slice]-selectors.ts module and import it into the saga.",
  create(_context, { sourceCode, classifyPath, report }) {
    const storeSelectors = createStoreCreateSelectorTracker(sourceCode);

    function isSelectorFactoryCall(node) {
      return storeSelectors.isStoreCreateSelectorCall(node);
    }

    return {
      VariableDeclarator(node) {
        if (!classifyPath().isSaga) return;
        const hasSelectorName = isSelectorIdentifier(node.id);
        const hasFactoryInit = isSelectorFactoryCall(node.init);
        if (!hasSelectorName && !hasFactoryInit) return;
        report({
          node: node.id,
          summary: `Saga-defined selector should live in a [slice]-selectors file and be imported into the saga.`,
        });
      },
      FunctionDeclaration(node) {
        if (!classifyPath().isSaga || !isSelectorIdentifier(node.id)) return;
        report({
          node: node.id,
          summary: `Saga-defined selector should live in a [slice]-selectors file and be imported into the saga.`,
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/${ruleId}`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};

export default plugin;
