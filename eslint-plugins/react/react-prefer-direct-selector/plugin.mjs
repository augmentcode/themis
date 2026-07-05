import { createImportedSelectorTracker, memberObjectName, memberPropertyName, traverse, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "react-prefer-direct-selector";

const selectorNamePattern = /^select[A-Z]/;

function isDirectImportedSelectorCall(node, selectorImports) {
  const current = unwrapExpression(node);
  return current?.type === "CallExpression" && selectorImports.isImportedSelectorIdentifier(current.callee);
}

function isPattern(node) {
  return ["ArrayPattern", "ObjectPattern"].includes(node?.type);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "React component read a selector through the `.useValue(...)` fallback instead of the direct signal call.",
  why: "Direct selector calls return a ReadonlySignal for React consumers; `.useValue(...)` reads a throttled plain value and is only a fallback for consumers that cannot accept signals.",
  fix: "Call the selector directly (`selectFoo(...args)`) and consume the signal; keep reviewed `.useValue(...)` fallbacks behind a narrow eslint-disable comment with a reason.",
  create(_context, { classifyPath, report }) {
    const selectorImports = createImportedSelectorTracker();
    const directSelectorSignals = new Set();

    return {
      Program(program) {
        const classification = classifyPath();
        if (!classification.isReactComponent || classification.isTest) return;

        traverse(program, {
          ImportDeclaration: selectorImports.recordImportDeclaration,
        });

        traverse(program, {
          CallExpression(node) {
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
          VariableDeclarator(node) {
            if (node.id?.type === "Identifier" && isDirectImportedSelectorCall(node.init, selectorImports)) {
              directSelectorSignals.add(node.id.name);
              return;
            }

            if (isPattern(node.id) && isDirectImportedSelectorCall(node.init, selectorImports)) {
              report({
                node: node.id,
                summary:
                  "Direct React selector calls return ReadonlySignal objects; read `.value` before destructuring a selector result or pass the signal through intentionally.",
              });
              return;
            }

            if (isPattern(node.id) && unwrapExpression(node.init)?.type === "Identifier" && directSelectorSignals.has(unwrapExpression(node.init).name)) {
              report({
                node: node.id,
                summary:
                  "Direct React selector calls return ReadonlySignal objects; destructure the selector signal's `.value` instead of the signal object.",
              });
            }
          },
          MemberExpression(node) {
            const object = unwrapExpression(node.object);
            if (object?.type !== "Identifier" || !directSelectorSignals.has(object.name)) return;
            if (memberPropertyName(node) === "value") return;

            report({
              node: node.property ?? node,
              summary:
                "Direct React selector calls return ReadonlySignal objects; read `.value` before accessing fields/items, pass the signal to a signal-aware prop, or use a reviewed `.useValue(...)` fallback.",
            });
          },
        });
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;

