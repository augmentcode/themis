import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "typed-saga-call-mock-guard";

function isIdentifierNamed(node, pattern) {
  return node?.type === "Identifier" && pattern.test(node.name);
}

function unwrapExpression(node) {
  let current = node;
  while (["ChainExpression", "TSAsExpression", "TSTypeAssertion", "TSNonNullExpression"].includes(current?.type)) {
    current = current.expression;
  }
  return current;
}

function staticPropertyName(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "Literal") return String(node.value);
  return undefined;
}

function isTypedSagaMockCall(node) {
  const callee = unwrapExpression(node.callee);
  return (
    callee?.type === "MemberExpression" &&
    isIdentifierNamed(unwrapExpression(callee.object), /^vi$/) &&
    staticPropertyName(callee.property) === "mock" &&
    node.arguments[0]?.type === "Literal" &&
    node.arguments[0].value === "typed-redux-saga"
  );
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "typed-redux-saga test mock replaced call without a tuple guard.",
  why: "redux-saga-test-plan passes `[context, method]` descriptors through `call`; mocks that do not branch on `Array.isArray(fnOrDescriptor)` break tuple calls.",
  fix: "Add an `Array.isArray(fnOrDescriptor)` branch before delegating to `redux-saga/effects.call` in the `typed-redux-saga` mock.",
  create(_context, { classifyPath, report }) {
    let hasTypedSagaMock = false;
    let callMockProperty;
    let hasArrayGuard = false;

    return {
      CallExpression(node) {
        if (!classifyPath().isTest) return;

        // Track the typed-redux-saga mock and the tuple guard through AST calls so
        // formatting changes do not affect whether the rule reports.
        if (isTypedSagaMockCall(node)) hasTypedSagaMock = true;

        const callee = unwrapExpression(node.callee);
        if (callee?.type !== "MemberExpression") return;
        if (isIdentifierNamed(unwrapExpression(callee.object), /^Array$/) && staticPropertyName(callee.property) === "isArray") {
          hasArrayGuard = true;
        }
      },
      Property(node) {
        if (!classifyPath().isTest || callMockProperty) return;
        if (staticPropertyName(node.key) === "call") callMockProperty = node;
      },
      "Program:exit"() {
        if (!hasTypedSagaMock || !callMockProperty || hasArrayGuard) return;
        report({
          node: callMockProperty.key,
          summary: "typed-redux-saga `call` mocks must guard `Array.isArray(fnOrDescriptor)` before delegating to redux-saga/effects.call.",
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/typed-saga-call-mock-guard`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
