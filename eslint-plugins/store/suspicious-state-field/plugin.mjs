import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "suspicious-state-field";

function propertyName(node) {
  return node.key?.name ?? (node.key?.value == null ? undefined : String(node.key.value));
}

function isStateShape(declaration) {
  return ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"].includes(declaration?.type) && declaration.id?.name?.endsWith("State");
}

function stateMembers(declaration) {
  return declaration.type === "TSInterfaceDeclaration" ? declaration.body.body : declaration.typeAnnotation?.type === "TSTypeLiteral" ? declaration.typeAnnotation.members : [];
}

function suspiciousStateReason(field) {
  if (/^(filtered|sorted|visible|displayed|derived|computed|matching)[A-Z_]/.test(field)) return "looks derived from another collection; keep it in a selector unless it is source data";
  if (/(Filtered|Sorted|Visible|Displayed|Derived|Computed|Matching)[A-Z_]/.test(field)) return "looks derived from another state value; keep it in a selector unless it is source data";
  if (/(Count|Total)$/.test(field) && field !== "count") return "looks like an aggregate that should usually be derived by a selector";
  return undefined;
}

function reportSuspiciousStateFields(report, shapeName, properties) {
  for (const property of properties) {
    const name = propertyName(property);
    if (!name) continue;
    const reason = suspiciousStateReason(name);
    if (reason) report({ node: property.key ?? property, summary: `Suspicious Redux state field "${name}" in ${shapeName}: ${reason}.` });
  }
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Redux state shape contains a suspicious derived field.",
  why: "Derived collections and totals should usually be computed by selectors to keep Redux state canonical.",
  fix: "Store only source data in Redux state and derive filtered, sorted, visible, displayed, computed, count, or total values in selectors.",
  create(_context, { report }) {
    return {
      ExportNamedDeclaration(node) {
        const declaration = node.declaration;
        if (!isStateShape(declaration)) return;

        // TypeScript state declarations expose field names through property
        // signatures, which lets this rule avoid source text matching entirely.
        reportSuspiciousStateFields(report, declaration.id.name, stateMembers(declaration));
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/suspicious-state-field`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
