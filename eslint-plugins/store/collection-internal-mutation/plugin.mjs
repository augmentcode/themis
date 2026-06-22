import { memberPropertyName, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "collection-internal-mutation";

const collectionInternals = new Set(["map", "ids", "refsCount"]);
const mutatingMethods = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "set", "delete", "clear"]);

function isAllowedCollectionInternalFile(path) {
  return path.endsWith("utils/collections/collection-utils.ts") || path.endsWith("utils/collections/collection-utils.js") || path.endsWith("utils/selector-core/create-cached-selector.ts");
}

function isCollectionInternalMember(node) {
  return collectionInternals.has(memberPropertyName(node));
}

function isCollectionInternalTarget(node) {
  const target = unwrapExpression(node);
  if (target?.type !== "MemberExpression") return false;

  // Detect both direct writes to collection.ids and writes to nested internals like collection.ids.length.
  return isCollectionInternalMember(target) || isCollectionInternalMember(target.object);
}

function collectionInternalName(node) {
  const target = unwrapExpression(node);
  return memberPropertyName(target) ?? memberPropertyName(unwrapExpression(target)?.object);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Source mutates Collection internals outside collection utilities.",
  why: "Direct writes to map, ids, or refsCount can desynchronize collection indexes and reference tracking.",
  fix: "Use the collection helper functions, or move the mutation into the approved collection utility implementation with tests.",
  create(_context, { classifyPath, report }) {
    return {
      AssignmentExpression(node) {
        if (isAllowedCollectionInternalFile(classifyPath().path) || !isCollectionInternalTarget(node.left)) return;

        report({
          node: node.left,
          summary: `Collection internals ".${collectionInternalName(node.left)}" must not be mutated outside collection utilities; use collection helper functions so refs and IDs remain consistent.`,
        });
      },
      UpdateExpression(node) {
        if (isAllowedCollectionInternalFile(classifyPath().path) || !isCollectionInternalTarget(node.argument)) return;

        report({
          node: node.argument,
          summary: "Collection internals must not be mutated outside collection utilities; use collection helper functions so refs and IDs remain consistent.",
        });
      },
      UnaryExpression(node) {
        if (node.operator !== "delete" || isAllowedCollectionInternalFile(classifyPath().path) || !isCollectionInternalTarget(node.argument)) return;

        report({
          node: node.argument,
          summary: "Collection internals must not be deleted outside collection utilities; use collection helper functions so refs and IDs remain consistent.",
        });
      },
      CallExpression(node) {
        if (isAllowedCollectionInternalFile(classifyPath().path)) return;

        const callee = unwrapExpression(node.callee);
        if (callee?.type !== "MemberExpression") return;
        if (!mutatingMethods.has(memberPropertyName(callee)) || !isCollectionInternalTarget(callee.object)) return;

        report({
          node: callee,
          summary: "Collection internals must not be mutated outside collection utilities; use collection helper functions so refs and IDs remain consistent.",
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/collection-internal-mutation`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
