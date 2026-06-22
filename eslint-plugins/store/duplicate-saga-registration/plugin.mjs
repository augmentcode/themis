import { calleeIdentifierName, staticString, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "duplicate-saga-registration";

function objectKeyName(property) {
  return property.key?.name ?? (property.key?.value == null ? undefined : String(property.key.value));
}

function sagaRegistrationLabel(property) {
  const value = unwrapExpression(property.value);
  if (value?.type !== "Identifier" || !value.name.endsWith("Saga")) return undefined;
  const key = objectKeyName(property);
  return key ? { key, node: property.key ?? property } : undefined;
}

function reportDuplicateSagaRegistration(report, seen, key, node) {
  if (!key) return;
  if (seen.has(key)) report({ node, summary: `Duplicate saga registration "${key}" found in this file. Each saga registry key/name must be unique.` });
  else seen.set(key, node);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Saga registration key or name is duplicated across the validation scope.",
  why: "Each saga registry key/name must resolve to one saga owner.",
  fix: "Use a unique saga registry key/name or remove the duplicate registration.",
  create(_context, { report }) {
    const seen = new Map();
    return {
      CallExpression(node) {
        if (calleeIdentifierName(node) !== "addSaga") return;
        const key = staticString(node.arguments[0]);
        reportDuplicateSagaRegistration(report, seen, key, node.arguments[0] ?? node);
      },
      ObjectExpression(node) {
        // Object literal registries (`{ todos: todosSaga }`) are checked alongside
        // addSaga calls so duplicate keys in inline registries use the same rule id.
        for (const property of node.properties) {
          const registration = property.type === "Property" ? sagaRegistrationLabel(property) : undefined;
          if (registration) reportDuplicateSagaRegistration(report, seen, registration.key, registration.node);
        }
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/duplicate-saga-registration`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
