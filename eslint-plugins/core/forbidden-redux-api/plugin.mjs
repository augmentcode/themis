import { calleeIdentifierName, staticString } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "forbidden-redux-api";

const forbiddenRtkHelpers = new Set(["createSlice", "configureStore", "createAsyncThunk", "createEntityAdapter", "createListenerMiddleware"]);

function importedName(specifier) {
  return specifier.imported?.name ?? specifier.imported?.value;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Source used a forbidden Redux or removed middleware API.",
  why: "This package exposes Store-first Redux utilities and has removed legacy middleware/context helpers.",
  fix: "Use the current Store, action, reducer, and middleware APIs exported by this package.",
  create(_context, { report }) {
    return {
      ImportDeclaration(node) {
        const sourcePath = staticString(node.source) ?? "";
        if (sourcePath.startsWith("@reduxjs/toolkit/")) {
          report({ node: node.source, summary: "Do not import Redux Toolkit internals/subpaths from this package source." });
          return;
        }
        if (sourcePath !== "@reduxjs/toolkit") return;
        if (node.specifiers.some((specifier) => forbiddenRtkHelpers.has(importedName(specifier)))) {
          report({ node: node.source, summary: "Use this package's Store-first Redux utilities instead of RTK helpers." });
        }
      }
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;