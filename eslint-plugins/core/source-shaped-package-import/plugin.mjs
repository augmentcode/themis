import { staticString } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "source-shaped-package-import";

const removedRelativeImports = new Set([
  "../slices/store-utility/store-utility-slice",
  "../middleware",
  "../middlewares/default",
  "../middlewares/saga",
  "../middlewares/state-reference-checks",
  "../utils/store/create-action",
  "../utils/store/create-reducer",
  "../utils/store/create-middleware",
]);

const sourceShapedPackagePattern = /^@augmentcode\/themis(?:$|\/(?:src|components|slices|middlewares?|init|redux-dispatch-bridge)(?:$|\/)|\/utils\/(?!collections\/collection-utils$|store\/(?:create-action|create-reducer|boolean-preference|domain-scoped)$|sagas\/(?:debounce-saga|retry-with-timeout|wrap-async-generator|selector-channel-effects)$).+)/;

function importSummary(sourcePath) {
  if (sourceShapedPackagePattern.test(sourcePath)) return "Use an exported @augmentcode/themis package subpath; root/source-shaped/removed paths are not public API.";
  if (removedRelativeImports.has(sourcePath)) return "Use stable package subpaths instead of removed/source-shaped relative imports.";
  return undefined;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Source imported a root, source-shaped, or removed package path.",
  why: "Only stable package subpaths are public API; source-shaped paths and removed relative paths couple consumers to internals.",
  fix: "Import from an approved @augmentcode/themis package subpath or current source owner instead.",
  create(_context, { report }) {
    function checkSource(node) {
      const sourcePath = staticString(node);
      const summary = importSummary(sourcePath ?? "");
      if (summary) report({ node, summary });
    }

    return {
      ImportDeclaration(node) {
        checkSource(node.source);
      },
      ImportExpression(node) {
        checkSource(node.source);
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;