import { isCallNamed } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "duplicate-selector-export";

const selectorFactories = new Set(["createSelector"]);

function declarationName(node) {
  return node?.type === "VariableDeclarator" && node.id?.type === "Identifier" ? node.id.name : undefined;
}

function exportedName(specifier) {
  return specifier.exported?.name ?? specifier.exported?.value;
}

function reportDuplicateSelectorExport(report, seen, name, node) {
  if (!name) return;
  if (seen.has(name)) report({ node, summary: `Duplicate selector export "${name}" found in this file. Give each selector a unique exported name.` });
  else seen.set(name, node);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Selector export name is duplicated across the validation scope.",
  why: "Selector names must identify one canonical state derivation.",
  fix: "Give each selector a unique exported name or reuse the existing selector.",
  create(_context, { report }) {
    const seen = new Map();
    const selectorDeclarations = new Set();
    return {
      VariableDeclarator(node) {
        if (isCallNamed(node.init, selectorFactories)) selectorDeclarations.add(declarationName(node));
      },
      ExportNamedDeclaration(node) {
        // Handle `export { localSelector as selectTodos }` after seeing the local
        // declaration, then handle inline exported selector declarations below.
        for (const specifier of node.specifiers ?? []) {
          const localName = specifier.local?.name ?? specifier.local?.value;
          if (selectorDeclarations.has(localName)) reportDuplicateSelectorExport(report, seen, exportedName(specifier), specifier.exported ?? specifier);
        }

        const declaration = node.declaration;
        if (declaration?.type !== "VariableDeclaration") return;
        for (const decl of declaration.declarations) {
          if (isCallNamed(decl.init, selectorFactories)) reportDuplicateSelectorExport(report, seen, declarationName(decl), decl.id);
        }
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/duplicate-selector-export`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
