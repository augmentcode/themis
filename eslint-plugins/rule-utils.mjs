export function normalizeArchitecturePath(filePath = "") {
  return filePath.replace(/\\/g, "/");
}

export function classifyArchitecturePath(filePath = "") {
  const path = normalizeArchitecturePath(filePath);
  const extension = path.endsWith(".svelte") ? ".svelte" : path.match(/\.[^.\/]+$/)?.[0] ?? "";
  return {
    path,
    extension,
    isSource: /^src\//.test(path),
    isTest: /(^|\/)[^/]+\.(test|spec)\.[^/]+$/.test(path),
    isSvelteComponent: path.endsWith(".svelte"),
    isReactComponent: path.endsWith(".tsx") || path.endsWith(".jsx"),
    isSaga: /(^|\/)sagas?\//.test(path) || /-saga\.[cm]?[jt]sx?$/.test(path),
    isSelector: /-selectors?\.[cm]?[jt]sx?$/.test(path),
    isStateOwner: /-slice\.[cm]?[jt]sx?$/.test(path),
  };
}

function normalizeRuleId(ruleId = "") {
  return ruleId.replace(/^architecture\//, "");
}

export function formatArchitectureMessage({ ruleId, summary, why, fix }) {
  return String(summary ?? normalizeRuleId(ruleId)).replace(/\s+/g, " ").trim();
}

export function architectureRuleMetadata({ ruleId, summary, why, fix, docsUrl }) {
  return {
    type: "problem",
    docs: { description: summary, recommended: false, url: docsUrl },
    schema: [],
    architecture: { ruleId: normalizeRuleId(ruleId), summary, why, fix },
  };
}

export function createArchitectureRule({ ruleId, summary, why, fix, docsUrl, create }) {
  return {
    meta: architectureRuleMetadata({ ruleId, summary, why, fix, docsUrl }),
    create(context) {
      const sourceCode = context.sourceCode ?? context.getSourceCode();
      const helpers = {
        ruleId: normalizeRuleId(ruleId),
        sourceCode,
        classifyPath: (filePath = context.filename ?? context.getFilename()) => classifyArchitecturePath(filePath),
        report: ({ node, loc, summary: localSummary = summary, why: localWhy = why, fix: localFix = fix }) => {
          context.report({ node, loc, message: formatArchitectureMessage({ ruleId, summary: localSummary, why: localWhy, fix: localFix }) });
          return true;
        },
      };
      return create(context, helpers);
    },
  };
}

export function createArchitectureRulePlugin(ruleId, rule, { version = "0.1.0" } = {}) {
  const normalizedRuleId = normalizeRuleId(ruleId);
  return {
    meta: {
      name: `eslint-plugin-themis-architecture/${normalizedRuleId}`,
      version,
    },
    rules: { [normalizedRuleId]: rule },
  };
}