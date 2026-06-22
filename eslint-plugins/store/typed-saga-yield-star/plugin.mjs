import { calleeIdentifierName, memberPropertyName, staticString, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "typed-saga-yield-star";

const typedEffects = new Set([
  "call",
  "put",
  "take",
  "fork",
  "spawn",
  "delay",
  "race",
  "all",
  "select",
  "cancel",
  "cancelled",
  "takeEvery",
  "takeLatest",
  "takeLeading",
  "getContext",
  "setContext",
  "actionChannel",
  "join",
]);

function isTypedSagaScope(classifyPath, importsTypedSaga) {
  return classifyPath().isSaga || importsTypedSaga;
}

function isTypedEffectCall(node) {
  if (node?.type !== "CallExpression") return false;

  const callee = unwrapExpression(node.callee);
  if (typedEffects.has(calleeIdentifierName(node))) return true;

  // Named selectors expose `.effect(...)`; those calls are typed saga effects
  // even though the callee is a member expression instead of a bare helper.
  return callee?.type === "MemberExpression" && memberPropertyName(callee) === "effect";
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "typed-redux-saga effect was yielded without delegation.",
  why: "Bare `yield` returns an effect descriptor and drops the typed result; `yield*` delegates to typed-redux-saga helpers correctly.",
  fix: "Rewrite typed saga effects and selector effects to use `yield*`, for example `const value = yield* call(fn)` or `yield* selectFoo.effect()`.",
  create(_context, { classifyPath, report }) {
    let importsTypedSaga = false;

    return {
      ImportDeclaration(node) {
        if (staticString(node.source) === "typed-redux-saga") importsTypedSaga = true;
      },
      YieldExpression(node) {
        // `yield*` is already delegated. Bare `yield` is only checked inside
        // saga files or files that explicitly import typed-redux-saga helpers.
        if (node.delegate || !isTypedSagaScope(classifyPath, importsTypedSaga)) return;

        const argument = unwrapExpression(node.argument);
        if (!isTypedEffectCall(argument)) return;

        report({
          node,
          summary: "typed-redux-saga effects must be delegated with yield*; bare yield returns the effect descriptor instead of the typed result.",
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/typed-saga-yield-star`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};

export default plugin;
