import { unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "duplicate-saga-name";

function sagaName(node) {
  if (node?.type === "FunctionDeclaration" && node.generator && node.id?.name?.endsWith("Saga")) return node.id.name;
  if (node?.type === "VariableDeclarator" && node.id?.name?.endsWith("Saga") && unwrapExpression(node.init)?.generator) return node.id.name;
  return undefined;
}

function reportDuplicateSagaName(report, seen, name, node) {
  if (!name) return;
  if (seen.has(name)) report({ node, summary: `Duplicate saga function name "${name}" found in this file. Rename one saga or reuse the existing implementation.` });
  else seen.set(name, node);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Saga function name is duplicated across the validation scope.",
  why: "Saga names must map clearly to one behavior owner.",
  fix: "Rename one saga or reuse the existing implementation.",
  create(_context, { report }) {
    const seen = new Map();
    return {
      FunctionDeclaration(node) {
        // Generator declarations carry the canonical saga name directly on id.
        reportDuplicateSagaName(report, seen, sagaName(node), node.id ?? node);
      },
      VariableDeclarator(node) {
        // `const fooSaga = function* () {}` keeps the public saga name on the id,
        // while the generator flag lives on the initializer expression.
        reportDuplicateSagaName(report, seen, sagaName(node), node.id);
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/duplicate-saga-name`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
