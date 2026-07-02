import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createArchitectureRule, createArchitectureRulePlugin, normalizeArchitecturePath } from "../../rule-utils.mjs";

export const ruleId = "single-slice-selectors-module";

const ownerModuleKinds = [
  { kind: "slice", pattern: /-slice\.[cm]?[jt]sx?$/, noun: "slice owner", suffix: "*-slice" },
  { kind: "selectors", pattern: /-selectors\.[cm]?[jt]sx?$/, noun: "selectors owner", suffix: "*-selectors" },
];

function ownerModuleKind(path) {
  const name = normalizeArchitecturePath(path).split("/").pop() ?? "";
  return ownerModuleKinds.find(({ pattern }) => pattern.test(name));
}

function displayDirectory(path) {
  const normalized = normalizeArchitecturePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? "." : normalized.slice(0, slash);
}

function absoluteDirectoryFor(filePath, architectureRoot) {
  if (!filePath || /^<.*>$/.test(filePath)) return undefined;
  if (isAbsolute(filePath)) return dirname(filePath);
  return resolve(architectureRoot ?? process.cwd(), dirname(normalizeArchitecturePath(filePath)));
}

function siblingOwnerModules(directory, kind) {
  if (!directory || !existsSync(directory)) return [];
  try {
    return readdirSync(directory)
      .filter((entry) => kind.pattern.test(entry))
      .filter((entry) => statSync(join(directory, entry)).isFile())
      .sort();
  } catch {
    return [];
  }
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Slice directory contains multiple slice or selectors owner modules.",
  why: "A slice directory should have one reducer/action owner and one selector owner so state, actions, and public read APIs map to one clear slice identity.",
  fix: "Keep one *-slice module and one *-selectors module per slice directory; split multiple slices into separate directories named after the slices.",
  create(context, { classifyPath, report }) {
    return {
      Program(node) {
        const path = classifyPath().path;
        const kind = ownerModuleKind(path);
        if (!kind) return;

        const modules = siblingOwnerModules(absoluteDirectoryFor(context.filename ?? context.getFilename(), context.settings?.architectureRoot), kind);
        if (modules.length <= 1) return;

        report({
          node,
          summary: `Slice directory "${displayDirectory(path)}" contains ${modules.length} ${kind.noun} modules (${modules.join(", ")}). Keep one ${kind.suffix} module per slice directory and split multiple slices into separate directories named after the slices.`,
        });
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;