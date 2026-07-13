import { calleeIdentifierName, createImportedSelectorTracker, staticPropertyName, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "selector-argument-stability";

const selectorFactories = new Set(["createSelector", "createCollectionItemSelector", "createCollectionItemsListSelector"]);
const selectorModeProperties = new Set(["select", "effect", "useValue"]);
const selectorChannelDirectArgHelpers = new Set(["createChannelFromSelector"]);
const selectorChannelTupleArgHelpers = new Set(["takeEveryFromSelector", "takeLatestFromSelector", "takeLeadingFromSelector", "waitFor"]);

function isStoreSelectorCreationCall(node) {
  const current = unwrapExpression(node);
  if (current?.type !== "CallExpression") return false;
  const callee = unwrapExpression(current.callee);
  return (
    (callee?.type === "MemberExpression" && staticPropertyName(callee.property) === "createSelector") ||
    selectorFactories.has(calleeIdentifierName(current))
  );
}

function selectorDefinitionCallback(node) {
  const current = unwrapExpression(node);
  if (current?.type !== "CallExpression") return undefined;
  const callee = unwrapExpression(current.callee);
  const args = current.arguments ?? [];
  if (callee?.type === "MemberExpression" && staticPropertyName(callee.property) === "createSelector") return args.find(isSelectorCallback);
  if (selectorFactories.has(calleeIdentifierName(current))) return args.slice(1).find(isSelectorCallback) ?? args.find(isSelectorCallback);
  return undefined;
}

function isSelectorCallback(node) {
  const current = unwrapExpression(node);
  return current?.type === "ArrowFunctionExpression" || current?.type === "FunctionExpression";
}

function isStableReference(node) {
  const current = unwrapExpression(node);
  return current?.type === "Identifier" || current?.type === "MemberExpression";
}

function unstableSelectorArgumentNode(node) {
  if (!node) return undefined;
  if (node.type === "SpreadElement") return isStableReference(node.argument) ? undefined : node;

  const current = unwrapExpression(node);
  if (
    current?.type === "ObjectExpression" ||
    current?.type === "ArrayExpression" ||
    current?.type === "ArrowFunctionExpression" ||
    current?.type === "FunctionExpression" ||
    current?.type === "ClassExpression" ||
    current?.type === "NewExpression"
  ) {
    return current;
  }
  return undefined;
}

function selectorTupleArgumentNodes(tupleNode) {
  const tuple = unwrapExpression(tupleNode);
  if (tuple?.type !== "ArrayExpression") return [unstableSelectorArgumentNode(tupleNode)].filter(Boolean);
  return (tuple.elements ?? []).flatMap((element) => {
    const unstable = unstableSelectorArgumentNode(element);
    return unstable ? [unstable] : [];
  });
}

function destructuredSelectorParamNodes(callback) {
  const current = unwrapExpression(callback);
  if (!isSelectorCallback(current)) return [];
  return (current.params ?? []).slice(1).filter((param) => {
    const expression = unwrapExpression(param);
    return expression?.type === "ObjectPattern" || expression?.type === "ArrayPattern";
  });
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Selector call or definition uses unstable compounded selector arguments.",
  why: "Fresh object, array, function, class, new, or spread-created selector arguments create a different cache key on every call and defeat selector output cache reuse.",
  fix: "Pass separate primitive/scalar selector arguments such as `selectTodo(todoId)`, or pass an intentionally stable identifier/member reference when object identity is the selector key.",
  create(_context, { report }) {
    const selectorImports = createImportedSelectorTracker();
    const localStoreSelectors = new Set();

    function isKnownSelectorIdentifier(node) {
      const current = unwrapExpression(node);
      return current?.type === "Identifier" && (selectorImports.hasImportedSelectorLocal(current.name) || localStoreSelectors.has(current.name));
    }

    function selectorCallArgumentNodes(node) {
      const callee = unwrapExpression(node.callee);

      if (isKnownSelectorIdentifier(callee)) return node.arguments ?? [];

      if (callee?.type === "MemberExpression" && isKnownSelectorIdentifier(callee.object)) {
        const property = staticPropertyName(callee.property);
        if (property === "select") return (node.arguments ?? []).slice(1);
        if (selectorModeProperties.has(property)) return node.arguments ?? [];
      }

      if (callee?.type === "CallExpression") {
        const innerCallee = unwrapExpression(callee.callee);
        if (
          innerCallee?.type === "MemberExpression" &&
          staticPropertyName(innerCallee.property) === "withStore" &&
          isKnownSelectorIdentifier(innerCallee.object)
        ) {
          return node.arguments ?? [];
        }
      }

      return [];
    }

    function selectorChannelArgumentNodes(node) {
      const helperName = calleeIdentifierName(node);
      if (selectorChannelDirectArgHelpers.has(helperName)) {
        return (node.arguments ?? []).slice(1).flatMap((argument) => {
          const unstable = unstableSelectorArgumentNode(argument);
          return unstable ? [unstable] : [];
        });
      }
      if (!selectorChannelTupleArgHelpers.has(helperName)) return [];

      const argsOrWorker = node.arguments?.[1];
      if (!argsOrWorker || isSelectorCallback(argsOrWorker)) return [];
      return selectorTupleArgumentNodes(argsOrWorker);
    }

    function reportUnstableArgument(node) {
      report({
        node,
        summary: "Selector arguments must be primitive/scalar values or stable references; avoid fresh object, array, function, class, new, or spread-created arguments.",
      });
    }

    return {
      ImportDeclaration: selectorImports.recordImportDeclaration,
      VariableDeclarator(node) {
        if (node.id?.type === "Identifier" && isStoreSelectorCreationCall(node.init)) localStoreSelectors.add(node.id.name);
      },
      CallExpression(node) {
        for (const argument of selectorCallArgumentNodes(node)) {
          const unstable = unstableSelectorArgumentNode(argument);
          if (unstable) reportUnstableArgument(unstable);
        }

        for (const argument of selectorChannelArgumentNodes(node)) reportUnstableArgument(argument);

        const callback = selectorDefinitionCallback(node);
        for (const param of destructuredSelectorParamNodes(callback)) {
          report({
            node: param,
            summary: "Selector callbacks should take separate primitive/scalar parameters after state instead of destructuring object or array selector args.",
          });
        }
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;