import { staticPropertyName, staticString, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "redundant-async-action-catch";

const actionModule = "@augmentcode/themis/utils/store/create-action";

function propertyName(node) {
  return node?.type === "MemberExpression"
    ? node.computed ? staticString(node.property) : staticPropertyName(node.property)
    : undefined;
}

function isMemberWrite(identifier) {
  let node = identifier;
  while (node.parent && (
    (node.parent.type === "MemberExpression" && node.parent.object === node) ||
    unwrapExpression(node.parent) === node
  )) node = node.parent;
  return node !== identifier && (
    (node.parent?.type === "AssignmentExpression" && node.parent.left === node) ||
    node.parent?.type === "UpdateExpression" ||
    (node.parent?.type === "UnaryExpression" && node.parent.operator === "delete")
  );
}

function createProvenanceTracker(sourceCode) {
  function variableFor(node) {
    for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
      const variable = scope.set?.get(node.name);
      if (variable) return variable;
    }
    return undefined;
  }

  function isFromActionModule(node, kind, seen = new Set()) {
    const current = unwrapExpression(node);
    if (!current) return false;

    if (current.type === "Identifier") {
      const variable = variableFor(current);
      if (!variable || seen.has(variable) || variable.defs.length !== 1) return false;
      // Do not infer provenance from a stale initializer or a replaced promise.
      if (variable.references.some((reference) =>
        (reference.isWrite() && !reference.init) || isMemberWrite(reference.identifier)
      )) return false;
      const nextSeen = new Set(seen).add(variable);
      const definition = variable.defs[0];
      const declaration = definition.node;
      const parent = declaration.parent ?? definition.parent;
      if (parent?.type === "ImportDeclaration") {
        if (staticString(parent.source) !== actionModule) return false;
        if ([parent.importKind, declaration.importKind].some((value) => value === "type" || value === "typeof")) return false;
        return kind === "namespace"
          ? declaration.type === "ImportNamespaceSpecifier"
          : kind === "factory" && declaration.type === "ImportSpecifier" && staticPropertyName(declaration.imported) === "createAsyncAction";
      }
      return declaration.type === "VariableDeclarator" && declaration.id.type === "Identifier" &&
        isFromActionModule(declaration.init, kind, nextSeen);
    }

    if (current.type === "CallExpression") {
      if (kind === "action") return isFromActionModule(current.callee, "creator", seen);
      if (kind === "creator") return isFromActionModule(current.callee, "factory", seen);
    }
    if (current.type === "MemberExpression") {
      if (kind === "promise" && propertyName(current) === "promise") return isFromActionModule(current.object, "action", seen);
      if (kind === "factory" && propertyName(current) === "createAsyncAction") return isFromActionModule(current.object, "namespace", seen);
    }
    return false;
  }

  return (node) => isFromActionModule(node, "promise");
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Redundant async-action promise catch: Themis already observes ignored rejections; await store.dispatch(action) when you need the outcome.",
  why: "Themis observes ignored async-action rejections without changing the promise or hiding failures from explicit awaiters.",
  fix: "Remove the action.promise.catch(...) call. When the outcome matters, await store.dispatch(action) and handle failures with try/catch.",
  create(_context, { sourceCode, report }) {
    const isAsyncActionPromise = createProvenanceTracker(sourceCode);
    return {
      CallExpression(node) {
        const callee = unwrapExpression(node.callee);
        if (propertyName(callee) === "catch" && isAsyncActionPromise(callee.object)) report({ node });
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;