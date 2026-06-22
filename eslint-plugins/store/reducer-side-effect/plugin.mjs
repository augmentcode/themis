import { calleeIdentifierName, memberPath, memberPropertyName, traverse, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "reducer-side-effect";

const sideEffectCalls = new Set(["fetch", "setTimeout", "setInterval", "queueMicrotask"]);
const nondeterministicMembers = new Set(["Date.now", "Math.random", "crypto.randomUUID"]);
const deterministicDateDerivationMethods = new Set(["getTime", "valueOf"]);

function isReducerFile(path) {
  return /(?:^|\/)[^/]*(?:reducer|slice)\.[cm]?[jt]sx?$/.test(path) || /(?:^|\/)[^/]*-slice\.[cm]?[jt]sx?$/.test(path);
}

function constructorName(node) {
  const callee = unwrapExpression(node?.callee);
  return callee?.type === "Identifier" ? callee.name : undefined;
}

function callName(node) {
  return calleeIdentifierName(node) ?? memberPath(unwrapExpression(node?.callee));
}

function isCreateReducerCall(node) {
  return unwrapExpression(node)?.type === "CallExpression" && calleeIdentifierName(node) === "createReducer";
}

function isCreateReducerBuilderExpression(node) {
  const current = unwrapExpression(node);
  if (isCreateReducerCall(current)) return true;
  if (current?.type !== "CallExpression") return false;

  const callee = unwrapExpression(current.callee);
  return callee?.type === "MemberExpression" && memberPropertyName(callee) === "with" && isCreateReducerBuilderExpression(callee.object);
}

function reducerHandlerArgument(node) {
  const callee = unwrapExpression(node?.callee);
  if (callee?.type !== "MemberExpression" || memberPropertyName(callee) !== "with") return undefined;
  if (!isCreateReducerBuilderExpression(callee.object)) return undefined;
  return unwrapExpression(node.arguments[1]);
}

function unwrapExportedDeclaration(node) {
  return node?.type === "ExportNamedDeclaration" ? node.declaration : node;
}

function recordHandler(handlerFunctions, name, handler) {
  if (!name || !handler?.body) return;
  handlerFunctions.set(name, handlerFunctions.has(name) ? undefined : handler);
}

function collectTopLevelHandlerFunctions(program) {
  const handlerFunctions = new Map();
  for (const statement of program?.body ?? []) {
    const declaration = unwrapExportedDeclaration(statement);
    if (declaration?.type === "FunctionDeclaration") {
      recordHandler(handlerFunctions, declaration.id?.name, declaration);
    } else if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations ?? []) {
        const init = unwrapExpression(declarator.init);
        if (["ArrowFunctionExpression", "FunctionExpression"].includes(init?.type)) recordHandler(handlerFunctions, declarator.id?.name, init);
      }
    }
  }
  return handlerFunctions;
}

function resolveReducerHandler(handler, handlerFunctions) {
  if (["ArrowFunctionExpression", "FunctionExpression"].includes(handler?.type)) return handler;
  if (handler?.type !== "Identifier") return undefined;
  return handlerFunctions.get(handler.name);
}

function nondeterministicValueLabel(node) {
  if (node?.type === "NewExpression" && constructorName(node) === "Date") return "new Date";
  if (node?.type !== "CallExpression") return undefined;

  const name = callName(node);
  if (nondeterministicMembers.has(name)) return name;
  return calleeIdentifierName(node) === "randomUUID" ? "randomUUID" : undefined;
}

function sideEffectLabel(node) {
  if (node?.type === "NewExpression") return constructorName(node) === "Promise" ? "Promise" : nondeterministicValueLabel(node);
  if (node?.type !== "CallExpression" && node?.type !== "MemberExpression") return undefined;

  const name = node.type === "CallExpression" ? callName(node) : memberPath(node);
  if (sideEffectCalls.has(name)) return name === "fetch" ? "fetch" : "timer";
  if (name?.startsWith("window.") || name?.startsWith("document.")) return "DOM/window API";
  if (name?.includes("localStorage")) return "localStorage";
  if (name?.startsWith("Promise.")) return "Promise";
  return nondeterministicValueLabel(node) ?? undefined;
}

function isDeterministicDateDerivation(node, parent) {
  if (node?.type !== "NewExpression" || constructorName(node) !== "Date" || node.arguments.length === 0) return false;
  if (unwrapExpression(parent)?.type !== "MemberExpression") return false;
  return deterministicDateDerivationMethods.has(memberPropertyName(parent));
}

function reportReducerSideEffect(report, node) {
  const label = sideEffectLabel(node);
  if (!label) return;

  report({
    node,
    summary: `Reducer/slice file contains side-effect or nondeterministic API "${label}"; reducers must compute next state from state + action only.`,
  });
}

function reportHandlerSideEffects(report, handler) {
  if (!handler?.body) return;

  traverse(handler.body, {
    CallExpression(node) {
      reportReducerSideEffect(report, node);
    },
    NewExpression(node, parent) {
      if (isDeterministicDateDerivation(node, parent)) return;
      reportReducerSideEffect(report, node);
    },
    MemberExpression(node) {
      // Member expressions catch DOM/window/localStorage reads even when they are not invoked.
      reportReducerSideEffect(report, node);
    },
  });
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Reducer or slice file contains a side effect or nondeterministic API.",
  why: "Reducers must compute next state from only state and action; side effects break replayability and make reducer tests flaky.",
  fix: "Move IO, timers, storage, randomness, and timestamp creation into sagas or action preparation and keep reducers synchronous and pure.",
  create(_context, { classifyPath, report }) {
    let handlerFunctions = new Map();

    return {
      Program(node) {
        handlerFunctions = collectTopLevelHandlerFunctions(node);
      },
      CallExpression(node) {
        if (!isReducerFile(classifyPath().path)) return;

        const handler = resolveReducerHandler(reducerHandlerArgument(node), handlerFunctions);
        reportHandlerSideEffects(report, handler);
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/reducer-side-effect`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
