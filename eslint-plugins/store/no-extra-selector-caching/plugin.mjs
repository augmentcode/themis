import { createImportedSelectorTracker, isFunctionNode, staticPropertyName, traverse, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "no-extra-selector-caching";

const wrapperNames = new Set(["memoize", "useMemo", "derived", "readable", "debounce", "throttle"]);
const selectorModeProperties = new Set(["select", "effect", "useValue", "withStore"]);

function isSelectorIdentifierName(name) {
  return typeof name === "string" && /^select[A-Z]/.test(name);
}

function wrapperNameForCall(node) {
  const callee = unwrapExpression(node?.callee);
  if (callee?.type === "Identifier") return wrapperNames.has(callee.name) ? callee.name : undefined;
  if (callee?.type !== "MemberExpression") return undefined;
  const property = staticPropertyName(callee.property);
  return wrapperNames.has(property) ? property : undefined;
}

function isStoreSelectorCreationCall(node) {
  const current = unwrapExpression(node);
  if (current?.type !== "CallExpression") return false;
  const callee = unwrapExpression(current.callee);
  return callee?.type === "MemberExpression" && staticPropertyName(callee.property) === "createSelector";
}

function isExportedSelectorWrapperCall(node) {
  const declarator = node.parent?.type === "VariableDeclarator" ? node.parent : undefined;
  const declaration = declarator?.parent?.type === "VariableDeclaration" ? declarator.parent : undefined;
  return Boolean(
    declaration?.parent?.type === "ExportNamedDeclaration" &&
      declarator.id?.type === "Identifier" &&
      isSelectorIdentifierName(declarator.id.name)
  );
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Store-created selector is wrapped in redundant caching or optimization.",
  why: "Store-created selectors already cache accessed state paths, track selector arguments, and coalesce Store-family emissions; adding another cache or scheduler can create stale values, duplicate scheduling, and hidden lifecycle problems.",
  fix: "Remove memoize/useMemo/derived/readable/debounce/throttle wrappers around selectors; compose selectors with `selectFoo.select(state, ...args)` and tune emissions only through Store constructor options such as `throttledSelectorFrequency`.",
  create(_context, { report }) {
    const selectorImports = createImportedSelectorTracker();
    const localStoreSelectors = new Set();

    function isKnownSelectorIdentifier(node) {
      const current = unwrapExpression(node);
      return current?.type === "Identifier" && (selectorImports.hasImportedSelectorLocal(current.name) || localStoreSelectors.has(current.name));
    }

    function selectorMemberUsageNode(node) {
      const current = unwrapExpression(node);
      if (current?.type !== "MemberExpression") return undefined;
      return isKnownSelectorIdentifier(current.object) && selectorModeProperties.has(staticPropertyName(current.property)) ? current : undefined;
    }

    function directSelectorUsageNode(node) {
      const current = unwrapExpression(node);
      if (!current) return undefined;
      if (isKnownSelectorIdentifier(current)) return current;
      if (selectorMemberUsageNode(current)) return current;
      if (isStoreSelectorCreationCall(current)) return current;
      if (current.type !== "CallExpression") return undefined;
      const callee = unwrapExpression(current.callee);
      if (isKnownSelectorIdentifier(callee) || selectorMemberUsageNode(callee)) return callee;
      return undefined;
    }

    function selectorUsageInTree(node) {
      let match;
      traverse(node, {
        "*"(child, parent) {
          if (match) return;
          if (parent?.type === "MemberExpression" && parent.property === child) return;
          match = directSelectorUsageNode(child);
        },
      });
      return match;
    }

    function selectorUsageNode(node) {
      const current = unwrapExpression(node);
      if (!current) return undefined;
      const direct = directSelectorUsageNode(current);
      if (direct) return direct;
      if (isFunctionNode(current)) return selectorUsageInTree(current.body);
      return selectorUsageInTree(current);
    }

    function wrapperSelectorArgument(node, wrapperName) {
      const args = wrapperName === "useMemo" ? node.arguments.slice(0, 1) : node.arguments;
      for (const argument of args) {
        const match = selectorUsageNode(argument);
        if (match) return match;
      }
      return undefined;
    }

    return {
      ImportDeclaration: selectorImports.recordImportDeclaration,
      VariableDeclarator(node) {
        if (node.id?.type === "Identifier" && isStoreSelectorCreationCall(node.init)) {
          localStoreSelectors.add(node.id.name);
        }
      },
      CallExpression(node) {
        const wrapperName = wrapperNameForCall(node);
        if (!wrapperName) return;

        const selectorNode = wrapperSelectorArgument(node, wrapperName);
        if (!selectorNode && !isExportedSelectorWrapperCall(node)) return;

        report({
          node: selectorNode ?? node,
          summary: `${wrapperName} wraps selector caching or scheduling that Store-created selectors already provide; remove the extra wrapper and use the selector directly.`,
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