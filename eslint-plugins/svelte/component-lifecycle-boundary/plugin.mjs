import { calleeIdentifierName, memberPropertyName, traverse, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "component-lifecycle-boundary";

function isStoreAccess(node) {
  if (node?.type === "CallExpression" && ["getDispatch", "getReduxStore"].includes(calleeIdentifierName(node))) return true;
  if (node?.type === "MemberExpression" && ["dispatch", "state"].includes(memberPropertyName(node))) return true;
  return false;
}

function expressionContains(node, predicate) {
  let found = false;

  // Walk the complete callback expression because store access may be nested in
  // declarations, conditionals, or member calls inside lifecycle handlers.
  traverse(node, {
    "*": (child) => {
      if (predicate(child)) found = true;
    },
  });

  return found;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Component lifecycle callback acquired Redux store access.",
  why: "Redux dispatch and store reads should be bound at component setup or routed through selectors so lifecycle callbacks stay action-driven and easy to test.",
  fix: "Bind dispatch/store-facing helpers outside lifecycle callbacks, dispatch explicit actions from handlers, and use selectors for state reads.",
  create(_context, { classifyPath, report }) {
    return {
      CallExpression(node) {
        if (!classifyPath().isSvelteComponent) return;

        const name = calleeIdentifierName(node);
        if (["onMount", "beforeUpdate", "afterUpdate"].includes(name) && expressionContains(node.arguments[0], isStoreAccess)) {
          report({
            node: unwrapExpression(node.callee),
            summary: "Do not acquire Redux dispatch/store inside component lifecycle callbacks; bind dispatch at component setup and keep lifecycle work action-driven.",
          });
        }

        if (["addEventListener", "setTimeout", "setInterval"].includes(name) && expressionContains(node, isStoreAccess)) {
          report({
            node: unwrapExpression(node.callee),
            summary: "Redux Store access in reactive or callback code is lifecycle-coupled; dispatch actions from explicit handlers and use selectors for reads.",
          });
        }
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/component-lifecycle-boundary`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
