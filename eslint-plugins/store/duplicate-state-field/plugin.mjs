import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "duplicate-state-field";

function propertyName(node) {
  return node.key?.name ?? (node.key?.value == null ? undefined : String(node.key.value));
}

function isStateShape(declaration) {
  return ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"].includes(declaration?.type) && declaration.id?.name?.endsWith("State");
}

function stateMembers(declaration) {
  return declaration.type === "TSInterfaceDeclaration" ? declaration.body.body : declaration.typeAnnotation?.type === "TSTypeLiteral" ? declaration.typeAnnotation.members : [];
}

function normalizedStateConcept(field) {
  const concept = field.replace(/^(filtered|sorted|visible|displayed|selected|all)/i, "").replace(/(ById|Ids|Map|List|Array|Items|Collection|Count|Total)$/i, "").toLowerCase().replace(/s$/, "");
  return concept.length >= 3 ? concept : undefined;
}

function hasDuplicatingStateToken(field) {
  return /^(filtered|sorted|visible|displayed|selected|all)/i.test(field) || /(ById|Ids|Map|List|Array|Items|Count|Total)$/i.test(field);
}

function reportDuplicateStateFields(report, shapeName, properties) {
  const seenNames = new Map();
  const concepts = new Map();
  for (const property of properties) {
    const name = propertyName(property);
    if (!name) continue;

    const existingName = seenNames.get(name);
    if (existingName) report({ node: property.key ?? property, summary: `Duplicate Redux state field "${name}" in ${shapeName}.` });
    seenNames.set(name, property);

    const concept = normalizedStateConcept(name);
    const previous = concept ? concepts.get(concept) : undefined;
    if (previous && (hasDuplicatingStateToken(previous.name) || hasDuplicatingStateToken(name))) {
      report({ node: property.key ?? property, summary: `Redux state fields "${previous.name}" and "${name}" in ${shapeName} look like duplicated representations; keep one source of truth and derive the other in selectors.` });
    } else if (concept) {
      concepts.set(concept, { name, property });
    }
  }
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Redux state shape contains duplicate or overlapping fields.",
  why: "Duplicate state fields create multiple sources of truth for the same concept.",
  fix: "Keep one source field and derive alternate views in selectors.",
  create(_context, { report }) {
    return {
      ExportNamedDeclaration(node) {
        const declaration = node.declaration;
        if (!isStateShape(declaration)) return;

        // This visitor keeps duplicate-field state per declared shape so two
        // interfaces in one file do not accidentally share field ownership.
        reportDuplicateStateFields(report, declaration.id.name, stateMembers(declaration));
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/duplicate-state-field`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
