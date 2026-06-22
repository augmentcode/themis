import { calleeIdentifierName, memberPath, memberPropertyName, traverse, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "nondeterministic-reducer-state";

const nondeterministicMembers = new Set(["Date.now", "Math.random", "crypto.randomUUID"]);

function isInitialStateIdentifier(node) {
  return node?.type === "Identifier" && (node.name === "initialState" || /initialState$/i.test(node.name));
}

function isReducerFile(path) {
  return /(?:^|\/)[^/]*(?:reducer|slice)\.[cm]?[jt]sx?$/.test(path) || /(?:^|\/)[^/]*-slice\.[cm]?[jt]sx?$/.test(path);
}

function plainObjectInitializer(node) {
  const init = unwrapExpression(node);
  return init?.type === "ObjectExpression" ? init : undefined;
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

function isFunctionNode(node) {
  return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node?.type);
}

function stateParameterNames(handler) {
  const state = unwrapExpression(handler?.params?.[0]);
  return state?.type === "Identifier" ? new Set([state.name]) : new Set();
}

function targetsReducerState(node, stateNames) {
  const current = unwrapExpression(node);
  if (current?.type === "Identifier") return stateNames.has(current.name);
  if (current?.type === "MemberExpression") return targetsReducerState(current.object, stateNames);
  return false;
}

function reportStateBoundHazard(report, node, reportedNodes) {
  if (reportedNodes.has(node)) return;
  reportedNodes.add(node);
  reportReducerNondeterminism(report, node);
}

function inspectStateBoundValue(report, node, directValue = true, seen = new Set(), valueHazards = new Map(), reportedNodes = new Set()) {
  const current = unwrapExpression(node);
  if (!current || seen.has(current)) return;
  seen.add(current);

  if (current.type === "Identifier") {
    for (const hazard of valueHazards.get(current.name) ?? []) reportStateBoundHazard(report, hazard, reportedNodes);
    return;
  }

  const label = nondeterministicValueLabel(current);
  if (label && (current.type === "CallExpression" || directValue || current.arguments.length === 0)) {
    reportStateBoundHazard(report, current, reportedNodes);
    return;
  }

  switch (current.type) {
    case "ObjectExpression":
      for (const property of current.properties ?? []) {
        if (property.type === "Property") inspectStateBoundValue(report, property.value, true, seen, valueHazards, reportedNodes);
        if (property.type === "SpreadElement") inspectStateBoundValue(report, property.argument, true, seen, valueHazards, reportedNodes);
      }
      break;
    case "ArrayExpression":
      for (const element of current.elements ?? []) inspectStateBoundValue(report, element, true, seen, valueHazards, reportedNodes);
      break;
    case "SpreadElement":
      inspectStateBoundValue(report, current.argument, directValue, seen, valueHazards, reportedNodes);
      break;
    case "ConditionalExpression":
      inspectStateBoundValue(report, current.consequent, directValue, seen, valueHazards, reportedNodes);
      inspectStateBoundValue(report, current.alternate, directValue, seen, valueHazards, reportedNodes);
      break;
    case "LogicalExpression":
      inspectStateBoundValue(report, current.left, directValue, seen, valueHazards, reportedNodes);
      inspectStateBoundValue(report, current.right, directValue, seen, valueHazards, reportedNodes);
      break;
    case "SequenceExpression": {
      const expressions = current.expressions ?? [];
      expressions.slice(0, -1).forEach((expression) => inspectStateBoundValue(report, expression, false, seen, valueHazards, reportedNodes));
      inspectStateBoundValue(report, expressions.at(-1), directValue, seen, valueHazards, reportedNodes);
      break;
    }
    case "CallExpression":
      inspectStateBoundValue(report, unwrapExpression(current.callee)?.object, false, seen, valueHazards, reportedNodes);
      for (const argument of current.arguments ?? []) {
        if (!isFunctionNode(unwrapExpression(argument))) inspectStateBoundValue(report, argument, false, seen, valueHazards, reportedNodes);
      }
      break;
    case "NewExpression":
      for (const argument of current.arguments ?? []) inspectStateBoundValue(report, argument, false, seen, valueHazards, reportedNodes);
      break;
    case "MemberExpression":
      inspectStateBoundValue(report, current.object, false, seen, valueHazards, reportedNodes);
      if (current.computed) inspectStateBoundValue(report, current.property, false, seen, valueHazards, reportedNodes);
      break;
    case "TemplateLiteral":
      for (const expression of current.expressions ?? []) inspectStateBoundValue(report, expression, false, seen, valueHazards, reportedNodes);
      break;
    case "TaggedTemplateExpression":
      inspectStateBoundValue(report, current.tag, false, seen, valueHazards, reportedNodes);
      inspectStateBoundValue(report, current.quasi, false, seen, valueHazards, reportedNodes);
      break;
    case "UnaryExpression":
    case "UpdateExpression":
      inspectStateBoundValue(report, current.argument, false, seen, valueHazards, reportedNodes);
      break;
    case "BinaryExpression":
      inspectStateBoundValue(report, current.left, false, seen, valueHazards, reportedNodes);
      inspectStateBoundValue(report, current.right, false, seen, valueHazards, reportedNodes);
      break;
    case "AssignmentExpression":
      inspectStateBoundValue(report, current.right, directValue, seen, valueHazards, reportedNodes);
      break;
  }
}

function collectStateBoundValueHazards(node, valueHazards) {
  const hazards = [];
  inspectStateBoundValue(({ node: hazard }) => hazards.push(hazard), node, true, new Set(), valueHazards, new Set());
  return hazards;
}

function collectHandlerValueHazards(handler) {
  const valueHazards = new Map();
  if (handler?.body?.type !== "BlockStatement") return valueHazards;

  walkHandlerBody(handler.body, {
    VariableDeclarator(node) {
      if (node.id?.type !== "Identifier") return;
      const hazards = collectStateBoundValueHazards(node.init, valueHazards);
      if (hazards.length > 0) valueHazards.set(node.id.name, hazards);
    },
  });
  return valueHazards;
}

function isObjectAssignToReducerState(node, stateNames) {
  return node?.type === "CallExpression" && callName(node) === "Object.assign" && targetsReducerState(node.arguments?.[0], stateNames);
}

function isReducerStateMutationCall(node, stateNames) {
  const callee = unwrapExpression(node?.callee);
  return callee?.type === "MemberExpression" && targetsReducerState(callee.object, stateNames);
}

function walkHandlerBody(node, visitors, root = node, parent = undefined) {
  if (!node || typeof node !== "object") return;
  if (node !== root && isFunctionNode(node)) return;

  visitors[node.type]?.(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (["parent", "tokens", "comments", "loc", "range"].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) walkHandlerBody(child, visitors, root, node);
    } else if (value?.type) {
      walkHandlerBody(value, visitors, root, node);
    }
  }
}

function reportInitialStateNondeterminism(report, declarator, objectNode) {
  // Initial state object literals need a deep walk so nested timestamps and UUIDs cannot hide in child values.
  traverse(objectNode, {
    "*"(child) {
      const label = nondeterministicValueLabel(child);
      if (!label) return;

      report({
        node: child,
        summary: `initialState "${declarator.id.name}" uses nondeterministic value "${label}"; derive timestamps/ids outside reducer state initialization.`,
      });
    },
  });
}

function reportReducerNondeterminism(report, node) {
  const label = nondeterministicValueLabel(node);
  if (!label) return;

  report({
    node,
    summary: `Reducer/slice state uses nondeterministic value "${label}"; create timestamps/random IDs in action preparation or saga code, not reducers.`,
  });
}

function reportHandlerNondeterminism(report, handler) {
  if (!handler?.body) return;

  const valueHazards = collectHandlerValueHazards(handler);
  const reportedNodes = new Set();

  if (handler.body.type !== "BlockStatement") {
    inspectStateBoundValue(report, handler.body, true, new Set(), valueHazards, reportedNodes);
    return;
  }

  const stateNames = stateParameterNames(handler);
  walkHandlerBody(handler.body, {
    ReturnStatement(node) {
      inspectStateBoundValue(report, node.argument, true, new Set(), valueHazards, reportedNodes);
    },
    AssignmentExpression(node) {
      if (targetsReducerState(node.left, stateNames)) inspectStateBoundValue(report, node.right, true, new Set(), valueHazards, reportedNodes);
    },
    CallExpression(node) {
      if (isObjectAssignToReducerState(node, stateNames)) {
        for (const argument of node.arguments.slice(1)) inspectStateBoundValue(report, argument, true, new Set(), valueHazards, reportedNodes);
      } else if (isReducerStateMutationCall(node, stateNames)) {
        for (const argument of node.arguments ?? []) {
          if (!isFunctionNode(unwrapExpression(argument))) inspectStateBoundValue(report, argument, true, new Set(), valueHazards, reportedNodes);
        }
      }
    },
  });
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Reducer or initialState uses nondeterministic data.",
  why: "Reducers must be repeatable for the same state and action so tests, replay, and debugging remain deterministic.",
  fix: "Create timestamps, random IDs, and UUIDs in action preparation or saga code, then pass the produced value through the action payload.",
  create(_context, { classifyPath, report }) {
    let handlerFunctions = new Map();

    return {
      Program(node) {
        handlerFunctions = collectTopLevelHandlerFunctions(node);
      },
      VariableDeclarator(node) {
        if (!isInitialStateIdentifier(node.id)) return;

        const objectNode = plainObjectInitializer(node.init);
        if (objectNode) reportInitialStateNondeterminism(report, node, objectNode);
      },
      CallExpression(node) {
        if (!isReducerFile(classifyPath().path)) return;

        const handler = resolveReducerHandler(reducerHandlerArgument(node), handlerFunctions);
        reportHandlerNondeterminism(report, handler);
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/nondeterministic-reducer-state`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
