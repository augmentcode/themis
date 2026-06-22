import { calleeIdentifierName, memberPropertyName, traverse } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "saga-watcher-action-type";

const watcherHelpers = new Set(["take", "takeEvery", "takeLatest", "takeLeading"]);

function firstActionTypeMember(node) {
  let match;

  // Watcher arguments can be wrapped in expressions; walk the complete first
  // argument and flag the first static `.type` member access we can prove.
  traverse(node, {
    MemberExpression(child) {
      if (!match && memberPropertyName(child) === "type") match = child;
    },
  });

  return match;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Saga watcher received an action .type string instead of the action creator.",
  why: "typed-redux-saga can infer the worker action only when take/takeEvery/takeLatest/takeLeading receive the action creator directly.",
  fix: "Pass the action creator to the watcher, for example `yield* takeEvery(loadTodos, worker)`, not `loadTodos.type`.",
  create(_context, { classifyPath, report }) {
    return {
      CallExpression(node) {
        const helperName = calleeIdentifierName(node);
        if (!classifyPath().isSaga || !watcherHelpers.has(helperName)) return;

        const actionType = firstActionTypeMember(node.arguments[0]);
        if (!actionType) return;

        report({
          node: actionType,
          summary: `${helperName} should receive action creators directly, not .type strings, so typed-redux-saga preserves action typing.`,
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/saga-watcher-action-type`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};

export default plugin;
