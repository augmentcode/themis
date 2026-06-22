import { calleeIdentifierName, memberPath, memberPropertyName, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "raw-channel-cleanup";

function callName(node) {
  return calleeIdentifierName(node) ?? memberPath(unwrapExpression(node?.callee));
}

function rawChannelCreator(node) {
  const name = callName(node);
  return name === "createChannelFromSelector" || name === "eventChannel";
}

function yieldedCall(node) {
  const current = unwrapExpression(node);
  return current?.type === "YieldExpression" ? unwrapExpression(current.argument) : current;
}

function closedChannelName(node) {
  const callee = unwrapExpression(node.callee);
  if (callee?.type !== "MemberExpression" || memberPropertyName(callee) !== "close") return undefined;

  const object = unwrapExpression(callee.object);
  return object?.type === "Identifier" ? object.name : undefined;
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Raw selector/event channel was created without detectable cleanup.",
  why: "Manual channels keep subscriptions alive until closed; missing cleanup leaks listeners and can keep stale saga work running.",
  fix: "Wrap manual channel usage in `try/finally` and call `channel.close()`, or replace it with an auto-cleanup selector channel helper.",
  create(_context, { classifyPath, report }) {
    const channels = new Map();
    const closed = new Set();

    return {
      VariableDeclarator(node) {
        // Track only simple saga-local variable bindings so the final report can
        // point at the channel identifier that needs a matching `.close()` call.
        if (!classifyPath().isSaga || node.id?.type !== "Identifier") return;

        const init = yieldedCall(node.init);
        if (init?.type === "CallExpression" && rawChannelCreator(init)) channels.set(node.id.name, node);
      },
      CallExpression(node) {
        const channelName = closedChannelName(node);
        if (channelName) closed.add(channelName);
      },
      "Program:exit"() {
        // Delay reporting until all call expressions have been visited; cleanup
        // often appears in finally blocks after the channel declaration.
        for (const [name, node] of channels) {
          if (closed.has(name)) continue;

          report({
            node: node.id,
            summary: `Raw channel "${name}" is created without a detectable ${name}.close(); wrap manual channel use in try/finally or use the auto-cleanup channel helpers.`,
          });
        }
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/raw-channel-cleanup`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};

export default plugin;
