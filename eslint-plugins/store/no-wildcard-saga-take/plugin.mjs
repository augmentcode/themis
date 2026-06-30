import { calleeIdentifierName, staticString, traverse } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "no-wildcard-saga-take";

const watcherHelpers = new Set(["take", "takeEvery", "takeLatest", "takeLeading"]);

function firstWildcardLiteral(node) {
  let match;

  // The first argument can be a literal, a template literal, or an array
  // pattern. Walk the whole sub-tree so wildcard literals nested inside
  // pattern arrays (e.g. `take(['*'])`) still report.
  traverse(node, {
    Literal(child) {
      if (!match && staticString(child) === "*") match = child;
    },
    TemplateLiteral(child) {
      if (!match && staticString(child) === "*") match = child;
    },
  });

  return match;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Saga watcher subscribed to every action with a wildcard take.",
  why: "Wildcard `take('*')` wakes the watcher for every dispatched action, including streaming bursts, which devastates saga throughput and obscures the actions the watcher actually cares about.",
  fix: "Replace the wildcard with the concrete action creator(s) or a selector channel; for example `yield* takeEvery(loadTodos, worker)` or `yield* takeEveryFromSelector(selectReady, worker)`.",
  create(_context, { classifyPath, report }) {
    return {
      CallExpression(node) {
        // Match the documented direct-import shape (`take`, `takeEvery`, ...);
        // aliased typed-redux-saga imports are explicitly out-of-scope and
        // would be covered by a separate import-tracking rule.
        const helperName = calleeIdentifierName(node);
        if (!classifyPath().isSaga || !watcherHelpers.has(helperName)) return;

        const wildcard = firstWildcardLiteral(node.arguments[0]);
        if (!wildcard) return;

        report({
          node: wildcard,
          summary: `${helperName} should not subscribe to '*'; pass concrete action creators or a selector channel so the watcher only wakes for relevant actions.`,
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/no-wildcard-saga-take`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};

export default plugin;
