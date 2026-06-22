import { reportProgram } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "shared-svelte-store-boundary";

function isAllowedComponentLocalStore(file) {
  return /(^|\/)components?\//.test(file) || /(^|\/)(fixtures?|migrations?|migration)\//.test(file);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Shared/domain Svelte store file crossed the Redux state boundary.",
  why: "Shared `*.store.svelte.ts` modules split canonical app state outside Redux and make state ownership ambiguous.",
  fix: "Move shared/domain state into Redux, or keep Svelte stores component-local or in explicit migration fixtures.",
  create(_context, { classifyPath, report, sourceCode }) {
    return {
      Program() {
        const path = classifyPath().path;
        if (path.endsWith(".store.svelte.ts") && !isAllowedComponentLocalStore(path)) {
          reportProgram(report, sourceCode, "Shared/domain *.store.svelte.ts files are deprecated; move shared state to Redux or keep only component-local/migration fixtures.");
        }
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;