import { memberObjectName, memberPropertyName, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "react-prefer-direct-selector";

const selectorNamePattern = /^select[A-Z]/;

export const rule = createArchitectureRule({
  ruleId,
  summary: "React component read a selector through the `.useValue(...)` fallback instead of the direct signal call.",
  why: "Direct selector calls return a ReadonlySignal for React consumers; `.useValue(...)` reads a throttled plain value and is only a fallback for consumers that cannot accept signals.",
  fix: "Call the selector directly (`selectFoo(...args)`) and consume the signal; keep reviewed `.useValue(...)` fallbacks behind a narrow eslint-disable comment with a reason.",
  create(_context, { classifyPath, report }) {
    return {
      CallExpression(node) {
        const classification = classifyPath();
        if (!classification.isReactComponent || classification.isTest) return;

        const callee = unwrapExpression(node.callee);
        if (memberPropertyName(callee) !== "useValue") return;

        const objectName = memberObjectName(callee);
        if (!objectName || !selectorNamePattern.test(objectName)) return;

        report({
          node: callee.property,
          summary:
            "Selector `.useValue(...)` reads a throttled plain value and is only a fallback; call the selector directly and consume the ReadonlySignal it returns.",
        });
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;

