import { memberObjectName, memberPath, memberPropertyName } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "direct-local-storage-usage";

const storageGlobalOwners = new Set(["window", "globalThis", "self"]);
const storageSummary = "Use safe local-storage saga helpers instead of direct localStorage access.";

function isAllowedSafeStorageHelper(path) {
  return /(^|\/)examples\/utils\/safe-local-storage-saga\.[jt]s$/.test(path);
}

function isPropertyName(node) {
  const parent = node.parent;
  return parent?.type === "MemberExpression" && parent.property === node && !parent.computed;
}

function isDeclarationName(node) {
  const parent = node.parent;
  return parent?.id === node || parent?.key === node || parent?.local === node;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Source used localStorage directly.",
  why: "Direct storage calls bypass the saga-safe helpers and can break SSR, tests, and error handling.",
  fix: "Use getLocalStorageItem/setLocalStorageItem/getLocalStorageJSON/setLocalStorageJSON from the safe helper layer.",
  create(_context, { classifyPath, report }) {
    function reportStorage(node) {
      if (isAllowedSafeStorageHelper(classifyPath().path)) return;
      report({ node, summary: storageSummary });
    }

    return {
      Identifier(node) {
        if (node.name !== "localStorage" || isPropertyName(node) || isDeclarationName(node)) return;
        reportStorage(node);
      },
      MemberExpression(node) {
        const objectName = memberObjectName(node);
        const propertyName = memberPropertyName(node);
        if (storageGlobalOwners.has(objectName) && propertyName === "localStorage") reportStorage(node);
        else if (memberPath(node) === "localStorage") reportStorage(node);
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;