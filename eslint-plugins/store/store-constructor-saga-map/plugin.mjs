import { unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "store-constructor-saga-map";

function isUndefinedLike(node) {
  const current = unwrapExpression(node);
  return !current || (current.type === "Identifier" && current.name === "undefined") || (current.type === "Literal" && current.value == null);
}

function looksLikeSagaMap(node) {
  const current = unwrapExpression(node);
  if (isUndefinedLike(current)) return false;
  if (current?.type === "ObjectExpression") return true;

  // Identifier names are the only non-literal signal available at this point;
  // keep the heuristic narrow to avoid flagging ordinary constructor options.
  return current?.type === "Identifier" && /(?:sagas?|sagaMap|sagaRegistry)$/i.test(current.name);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Store constructor received a saga map as its second argument.",
  why: "Constructor saga maps are a stale registration path; explicit Store.registerSagas keeps reducer construction, registration, and startup order auditable.",
  fix: "Create the Store with reducers/middleware only, then chain or call `store.registerSagas(sagasMap)` before `store.init()` or `store.runSaga(name)`.",
  create(_context, { report }) {
    return {
      NewExpression(node) {
        const callee = unwrapExpression(node.callee);
        if (callee?.type !== "Identifier" || callee.name !== "Store") return;

        const sagaMapArgument = node.arguments[1];
        if (!looksLikeSagaMap(sagaMapArgument)) return;

        report({
          node: sagaMapArgument,
          summary: "Store constructor saga maps are stale; create the Store with reducers/middleware only and chain Store.registerSagas(sagasMap) before init/runSaga.",
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/store-constructor-saga-map`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};

export default plugin;
