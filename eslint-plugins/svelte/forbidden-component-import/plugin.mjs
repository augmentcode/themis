import { staticString } from "../../ast-utils.mjs";
import { componentImportMessage } from "../../component-import-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "forbidden-component-import";

export const rule = createArchitectureRule({
  ruleId,
  summary: "Component imported a forbidden implementation boundary.",
  why: "Components should depend on actions, selectors, and store-facing APIs so saga, reducer, and collection internals remain replaceable.",
  fix: "Remove the component import of saga/reducer/collection internals and dispatch an action or read a selector instead.",
  create(_context, { classifyPath, report }) {
    return {
      ImportDeclaration(node) {
        if (!classifyPath().isSvelteComponent) return;
        const sourcePath = staticString(node.source);
        const summary = componentImportMessage(sourcePath ?? "");
        if (summary) report({ node: node.source, summary });
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;