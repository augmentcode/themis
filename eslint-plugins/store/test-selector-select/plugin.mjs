import { createImportedSelectorTracker, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "test-selector-select";

function isIdentifierNamed(node, pattern) {
  return node?.type === "Identifier" && pattern.test(node.name);
}

function isStateLikeArgument(node) {
  const expression = unwrapExpression(node);
  if (!expression) return false;
  if (expression.type === "ObjectExpression") return true;
  if (expression.type === "Identifier") return /state/i.test(expression.name);

  // Test fixtures often build state through helpers such as withTodosState();
  // treat those helpers as explicit mock-state inputs without relying on text scans.
  return expression.type === "CallExpression" && isIdentifierNamed(unwrapExpression(expression.callee), /^with[A-Za-z0-9_$]*$/);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Selector test called the readable selector form with state.",
  why: "The bare `selectFoo(state)` form creates a Svelte readable and needs component context; tests that pass mock state should exercise the pure selector contract.",
  fix: "Call `selectFoo.select(state, ...args)` in tests instead of `selectFoo(state, ...args)`.",
  create(_context, { classifyPath, report }) {
    const selectorImports = createImportedSelectorTracker();

    return {
      ImportDeclaration: selectorImports.recordImportDeclaration,
      CallExpression(node) {
        if (!classifyPath().isTest) return;

        // The rule tracks runtime named imports from selector modules, then checks
        // the first argument's AST shape for mock state usage.
        const callee = unwrapExpression(node.callee);
        if (!selectorImports.isImportedSelectorIdentifier(callee)) return;
        if (!isStateLikeArgument(node.arguments[0])) return;

        report({
          node: callee,
          summary: `Selector test must call ${callee.name}.select(state, ...args) instead of ${callee.name}(state, ...args).`,
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/test-selector-select`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
