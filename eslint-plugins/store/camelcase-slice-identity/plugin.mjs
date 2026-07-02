import { calleeIdentifierName, staticString, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "camelcase-slice-identity";

const actionFactories = new Set(["createAction", "createAsyncAction"]);
const storeConstructors = new Set(["Store", "ReactStore", "StreamingStore"]);
const lowerCamelCaseName = /^[a-z][A-Za-z0-9]*$/;

function isLowerCamelCase(name) {
  return lowerCamelCaseName.test(name);
}

function actionLiteralArguments(node) {
  const factoryName = calleeIdentifierName(node);
  const count = factoryName === "createAsyncAction" ? 2 : 1;
  return node.arguments
    .slice(0, count)
    .map((argument) => ({ node: argument, value: staticString(argument) }))
    .filter(({ value }) => typeof value === "string");
}

function actionNamespace(actionType) {
  const slashIndex = actionType.indexOf("/");
  if (slashIndex <= 0) return undefined;
  return actionType.slice(0, slashIndex);
}

function reducerMapKey(property) {
  if (property?.type !== "Property") return undefined;
  if (!property.computed && property.key?.type === "Identifier") return { node: property.key, value: property.key.name };
  const value = staticString(property.key);
  return typeof value === "string" ? { node: property.key, value } : undefined;
}

function reducerMapObject(node, reducerMapObjects) {
  const current = unwrapExpression(node);
  if (current?.type === "ObjectExpression") return current;
  if (current?.type === "Identifier") return reducerMapObjects.get(current.name);
  return undefined;
}

function storeConstructorName(node) {
  const callee = unwrapExpression(node.callee);
  return callee?.type === "Identifier" ? callee.name : undefined;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Slice identity is not lowerCamelCase.",
  why: "Action namespaces and Store reducer-map keys are logical slice identities; keeping them lowerCamelCase avoids drift between reducers, selectors, sagas, and action streams.",
  fix: "Rename the logical slice identity to lowerCamelCase, such as `todoItems`, while keeping physical slice file paths in their documented kebab-case form.",
  create(_context, { report }) {
    const reducerMapObjects = new Map();
    const reportedReducerKeys = new WeakSet();

    function reportSliceIdentity(node, name, surface) {
      if (!name || isLowerCamelCase(name)) return;
      report({
        node,
        summary: `${surface} "${name}" should be lowerCamelCase because it is a logical slice identity.`,
      });
    }

    function checkReducerMap(objectExpression) {
      for (const property of objectExpression?.properties ?? []) {
        const key = reducerMapKey(property);
        if (!key || reportedReducerKeys.has(key.node)) continue;
        reportedReducerKeys.add(key.node);
        reportSliceIdentity(key.node, key.value, "Store reducer-map key");
      }
    }

    return {
      VariableDeclarator(node) {
        const init = unwrapExpression(node.init);
        if (node.id?.type === "Identifier" && init?.type === "ObjectExpression") reducerMapObjects.set(node.id.name, init);
      },
      CallExpression(node) {
        if (!actionFactories.has(calleeIdentifierName(node))) return;

        for (const literal of actionLiteralArguments(node)) {
          reportSliceIdentity(literal.node, actionNamespace(literal.value), "Action type namespace");
        }
      },
      NewExpression(node) {
        if (!storeConstructors.has(storeConstructorName(node))) return;
        checkReducerMap(reducerMapObject(node.arguments[0], reducerMapObjects));
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;