import { calleeIdentifierName, memberPath } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "state-type-name";

function typeReferenceName(node) {
  if (node?.type !== "TSTypeReference") return undefined;
  return memberPath(node.typeName);
}

function typeArguments(node) {
  return node.typeArguments?.params ?? node.typeParameters?.params ?? [];
}

function reportIfNotState({ node, typeNode, report, summary }) {
  const name = typeReferenceName(typeNode);
  if (name && !name.endsWith("State")) report({ node, summary });
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Reducer state type name does not end in State.",
  why: "State suffixes make canonical Redux state shapes easy to distinguish from DTOs, collections, and utility types.",
  fix: "Rename reducer state types used by initialState/createReducer so they end in State.",
  create(_context, { report }) {
    return {
      VariableDeclarator(node) {
        if (node.id?.type !== "Identifier" || !/initialState$/i.test(node.id.name)) return;
        reportIfNotState({
          node: node.id,
          typeNode: node.id.typeAnnotation?.typeAnnotation,
          report,
          summary: "The state type used by initialState should end in State.",
        });
      },
      CallExpression(node) {
        if (calleeIdentifierName(node) !== "createReducer") return;
        reportIfNotState({
          node: node.callee,
          typeNode: typeArguments(node)[0],
          report,
          summary: "The createReducer<T> state type should end in State.",
        });
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;