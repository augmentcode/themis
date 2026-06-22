import { traverse, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "non-serializable-initial-state";

const runtimeConstructors = new Set(["Date", "Map", "Set", "WeakMap", "WeakSet", "RegExp", "Error", "Promise"]);

function isInitialStateIdentifier(node) {
  return node?.type === "Identifier" && (node.name === "initialState" || /initialState$/i.test(node.name));
}

function plainObjectInitializer(node) {
  const init = unwrapExpression(node);
  return init?.type === "ObjectExpression" ? init : undefined;
}

function constructorName(node) {
  const callee = unwrapExpression(node?.callee);
  return callee?.type === "Identifier" ? callee.name : undefined;
}

function runtimeValueLabel(node) {
  if (node.type === "NewExpression") {
    const name = constructorName(node);
    return runtimeConstructors.has(name) ? name : undefined;
  }

  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return "function";
  return undefined;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Redux initialState creates a non-serializable runtime value.",
  why: "Initial state seeds the canonical store; runtime objects make persistence, equality checks, and devtools replay unreliable.",
  fix: "Initialize state with plain serializable data and construct runtime helpers in selectors, sagas, components, or utility code.",
  create(_context, { report }) {
    return {
      VariableDeclarator(node) {
        if (!isInitialStateIdentifier(node.id)) return;

        const objectNode = plainObjectInitializer(node.init);
        if (!objectNode) return;

        // Inspect every value nested under the object literal because runtime values are often buried in arrays or child objects.
        traverse(objectNode, {
          "*"(child) {
            const label = runtimeValueLabel(child);
            if (!label) return;

            report({
              node: child,
              summary: `initialState "${node.id.name}" creates non-serializable runtime value "${label}"; store plain serializable data instead.`,
            });
          },
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/non-serializable-initial-state`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
