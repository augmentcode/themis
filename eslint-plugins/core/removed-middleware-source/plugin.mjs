import { reportProgram } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "removed-middleware-source";

export const rule = createArchitectureRule({
  ruleId,
  summary: "Removed middleware source file is still present.",
  why: "The legacy middleware source paths were removed in favor of Store constructor middleware and Store.addMiddleware.",
  fix: "Move middleware to current Store registration APIs or delete the removed source path.",
  create(_context, { classifyPath, report, sourceCode }) {
    return {
      Program() {
        const path = classifyPath().path;
        if (path === "src/middleware.ts" || /^src\/middlewares\//.test(path)) {
          reportProgram(report, sourceCode, "Removed middleware source files are not allowed; use Store constructor middleware or Store.addMiddleware.");
        }
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;