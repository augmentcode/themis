import { calleeIdentifierName, memberObjectName, memberPropertyName, staticPropertyName, staticString, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule, createArchitectureRulePlugin } from "../../rule-utils.mjs";

export const ruleId = "shared-react-store-boundary";

const signalModuleSources = new Set(["@preact/signals-react", "@preact/signals-core"]);
const signalFactoryNames = new Set(["signal", "computed"]);

function isAllowedComponentLocalStore(file) {
  return /(^|\/)components?\//.test(file) || /(^|\/)(fixtures?|migrations?|migration)\//.test(file);
}

function isSharedReactStoreModule(path) {
  return /\.store\.tsx?$/.test(path) && !isAllowedComponentLocalStore(path);
}

function collectSignalFactoryImports(program) {
  const locals = new Set();
  const namespaces = new Set();

  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    if (!signalModuleSources.has(staticString(statement.source) ?? "")) continue;

    for (const specifier of statement.specifiers ?? []) {
      if (specifier.importKind === "type" || specifier.local?.type !== "Identifier") continue;
      if (specifier.type === "ImportSpecifier" && signalFactoryNames.has(staticPropertyName(specifier.imported))) locals.add(specifier.local.name);
      if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
    }
  }

  return { locals, namespaces };
}

function isSignalFactoryCall(node, { locals, namespaces }) {
  const call = unwrapExpression(node);
  if (call?.type !== "CallExpression") return false;
  const calleeName = calleeIdentifierName(call);
  if (calleeName) return locals.has(calleeName);
  return namespaces.has(memberObjectName(call.callee)) && signalFactoryNames.has(memberPropertyName(call.callee));
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Shared/domain React store module crossed the Redux state boundary.",
  why: "Shared `*.store.ts(x)` modules that export module-level signal state split canonical app state outside Redux and make state ownership ambiguous.",
  fix: "Move shared/domain state into Redux, or keep React signal state component-local or in explicit migration fixtures.",
  create(_context, { classifyPath, report }) {
    return {
      Program(program) {
        const path = classifyPath().path;
        if (!isSharedReactStoreModule(path)) return;

        const signalImports = collectSignalFactoryImports(program);
        if (signalImports.locals.size === 0 && signalImports.namespaces.size === 0) return;

        const summary = "Shared/domain *.store.ts(x) files must not export module-level signal state; move shared state to Redux or keep signals component-local/migration fixtures.";
        const moduleSignalStateNames = new Set();

        for (const statement of program.body) {
          const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
          if (declaration?.type !== "VariableDeclaration") continue;

          for (const declarator of declaration.declarations) {
            if (!isSignalFactoryCall(declarator.init, signalImports)) continue;
            if (declarator.id?.type === "Identifier") moduleSignalStateNames.add(declarator.id.name);
            if (statement.type === "ExportNamedDeclaration") report({ node: declarator, summary });
          }
        }

        for (const statement of program.body) {
          if (statement.type === "ExportNamedDeclaration" && !statement.declaration) {
            for (const specifier of statement.specifiers ?? []) {
              if (specifier.local?.type === "Identifier" && moduleSignalStateNames.has(specifier.local.name)) report({ node: specifier, summary });
            }
          }

          if (statement.type === "ExportDefaultDeclaration") {
            const value = unwrapExpression(statement.declaration);
            if (isSignalFactoryCall(statement.declaration, signalImports) || (value?.type === "Identifier" && moduleSignalStateNames.has(value.name))) {
              report({ node: statement.declaration, summary });
            }
          }
        }
      },
    };
  },
});

export const plugin = createArchitectureRulePlugin(ruleId, rule);
export default plugin;

