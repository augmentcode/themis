import { calleeIdentifierName, exportedDeclaration, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "pass-through-wrapper";

function isSkippedWrapperPath(path) {
  return /(^|\/)index\.[cm]?[jt]sx?$/.test(path) || /-types\.[cm]?[jt]sx?$/.test(path);
}

function identifierName(node) {
  const current = unwrapExpression(node);
  return current?.type === "Identifier" ? current.name : undefined;
}

function isSamePassThroughArgument(param, argument) {
  if (param?.type === "RestElement") {
    return argument?.type === "SpreadElement" && identifierName(param.argument) === identifierName(argument.argument);
  }

  return param?.type === "Identifier" && argument?.type !== "SpreadElement" && param.name === identifierName(argument);
}

function hasSamePassThroughArguments(params = [], args = []) {
  return params.length === args.length && params.every((param, index) => isSamePassThroughArgument(param, args[index]));
}

function delegatedCallFromStatement(statement) {
  const expression = statement?.type === "ReturnStatement" ? statement.argument : statement?.type === "ExpressionStatement" ? statement.expression : undefined;
  const current = unwrapExpression(expression);
  if (current?.type !== "YieldExpression" || !current.delegate) return undefined;
  const argument = unwrapExpression(current.argument);
  return argument?.type === "CallExpression" ? argument : undefined;
}

function isPassThroughSagaWrapper(node) {
  if (!node?.generator || node.body?.type !== "BlockStatement") return false;

  const body = node.body.body.filter((statement) => statement.type !== "EmptyStatement");
  if (body.length !== 1) return false;

  const call = delegatedCallFromStatement(body[0]);
  if (!call) return false;
  if (node.id?.name && calleeIdentifierName(call) === node.id.name) return false;

  return hasSamePassThroughArguments(node.params, call.arguments);
}

function isPassThroughProgram(program) {
  const body = program.body.filter((node) => node.type !== "EmptyStatement");

  // Pure re-export wrappers are actionable even when there are multiple export
  // statements, because they hide the canonical owner after refactors.
  if (body.length > 0 && body.length <= 2 && body.every((node) => (node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") && node.source)) {
    return body[0];
  }

  if (body.length !== 2 || body[0].type !== "ImportDeclaration") return undefined;

  const imported = body[0].specifiers.find((specifier) => specifier.type === "ImportSpecifier")?.local?.name;
  const exported = exportedDeclaration(body[1]);
  if (!imported || !exported) return undefined;

  if (exported.type === "FunctionDeclaration") {
    const statement = exported.body?.body?.[0];
    if (statement?.type === "ReturnStatement" && calleeIdentifierName(statement.argument) === imported) return exported;
  }

  if (exported.type === "VariableDeclaration") {
    const init = exported.declarations[0]?.init;
    const bodyNode = unwrapExpression(init)?.body;
    if (init?.type === "ArrowFunctionExpression" && calleeIdentifierName(bodyNode) === imported) return exported;
  }

  return undefined;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "File is only a pass-through wrapper or re-export.",
  why: "Leftover wrappers hide the canonical owner after refactors and keep stale compatibility surfaces alive.",
  fix: "Remove the wrapper or add a reviewed ESLint disable comment with compatibility and sunset/removal details.",
  create(_context, { classifyPath, report }) {
    function reportSagaWrapper(node) {
      if (isSkippedWrapperPath(classifyPath().path) || !isPassThroughSagaWrapper(node)) return;

      report({
        node,
        summary: "Saga pass-through wrappers must inline the selector/effect call, or keep the wrapper only with a rule-specific ESLint disable reason documenting compatibility and sunset/removal conditions.",
      });
    }

    return {
      Program(node) {
        const path = classifyPath().path;
        if (isSkippedWrapperPath(path)) return;

        const target = isPassThroughProgram(node);
        if (!target) return;

        report({
          node: target,
          summary: "Pass-through wrappers/re-exports must be removed after refactors, or kept only with a rule-specific ESLint disable reason documenting compatibility and sunset/removal conditions.",
        });
      },
      FunctionDeclaration: reportSagaWrapper,
      FunctionExpression: reportSagaWrapper,
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/pass-through-wrapper`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
