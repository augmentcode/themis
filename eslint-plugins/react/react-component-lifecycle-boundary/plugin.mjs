import { calleeIdentifierName, memberPropertyName, traverse, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "react-component-lifecycle-boundary";

function isStoreAccess(node) {
  if (node?.type === "CallExpression" && ["getDispatch", "getReduxStore"].includes(calleeIdentifierName(node))) return true;
  if (node?.type === "MemberExpression" && ["dispatch", "state"].includes(memberPropertyName(node))) return true;
  return false;
}

function expressionContains(node, predicate) {
  let found = false;

  // Walk the complete callback expression because store access may be nested in
  // declarations, conditionals, or member calls inside effect callbacks.
  traverse(node, {
    "*": (child) => {
      if (predicate(child)) found = true;
    },
  });

  return found;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "React effect callback acquired Redux store access.",
  why: "Redux dispatch and store reads should be bound at component setup or routed through selectors so effect callbacks stay action-driven and easy to test.",
  fix: "Bind dispatch/store-facing helpers outside effect callbacks, dispatch explicit actions from handlers, and use selectors for state reads.",
  create(_context, { classifyPath, report }) {
    return {
      CallExpression(node) {
        if (!classifyPath().isReactComponent) return;

        const name = calleeIdentifierName(node);
        if (["useEffect", "useLayoutEffect", "useInsertionEffect"].includes(name) && expressionContains(node.arguments[0], isStoreAccess)) {
          report({
            node: unwrapExpression(node.callee),
            summary: "Do not acquire Redux dispatch/store inside React effect callbacks; bind dispatch at component setup and keep effects action-driven.",
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

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;

