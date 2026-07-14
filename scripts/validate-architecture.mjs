#!/usr/bin/env node

import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Linter } from "eslint";
import { parse } from "@babel/parser";
import { core as architectureConfig } from "../eslint-plugins/index.mjs";
import { architectureRulePlugins, nativeReplacementRulePlugins, sagaSelectorChannelRulePlugins, sourceBoundaryRulePlugins, stateCollectionReducerRulePlugins, testPatternRulePlugins } from "../eslint-plugins/plugins/index.mjs";

const tsParser = {
  meta: { name: "local-babel-ts-parser" },
  parseForESLint(code) {
    const ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx", "estree"], ranges: true, tokens: true, errorRecovery: true });
    ast.tokens = ast.tokens.filter((token) => Number.isInteger(token.start) && Number.isInteger(token.end) && typeof token.type?.label === "string").map((token) => ({ type: token.type.label, value: token.value == null ? code.slice(token.start, token.end) : String(token.value), loc: token.loc, range: [token.start, token.end] }));
    ast.comments = (ast.comments ?? []).map((comment) => ({ ...comment, type: comment.type === "CommentLine" ? "Line" : comment.type === "CommentBlock" ? "Block" : comment.type, range: [comment.start, comment.end] }));
    return { ast };
  },
};
const architectureBaseConfig = architectureConfig.find((entry) => entry.plugins) ?? {};
const architectureLanguageOptions = { ...(architectureConfig.find((entry) => entry.languageOptions)?.languageOptions ?? {}), parser: tsParser };
const architecturePlugin = architectureBaseConfig.plugins?.architecture ?? architectureBaseConfig.plugins?.["themis"];

function architectureErrorRules(rulePlugins) {
  return Object.fromEntries(Object.keys(rulePlugins).map((ruleId) => [`architecture/${ruleId}`, "error"]));
}

export const architectureRules = {
  duplicateActionType: "duplicate-action-type",
  duplicateSelectorExport: "duplicate-selector-export",
  duplicateSelectorImplementation: "duplicate-selector-implementation",
  duplicateSagaName: "duplicate-saga-name",
  duplicateSagaRegistration: "duplicate-saga-registration",
  singleSliceSelectorsModule: "single-slice-selectors-module",
  suspiciousStateField: "suspicious-state-field",
  duplicateStateField: "duplicate-state-field",
  forbiddenComponentImport: "forbidden-component-import",
  unnamespacedActionType: "unnamespaced-action-type",
  nonSerializableStateType: "non-serializable-state-type",
  directLocalStorageUsage: "direct-local-storage-usage",
  sagaWatcherActionType: "saga-watcher-action-type",
  inlineSagaSelector: "inline-saga-selector",
  forbiddenReduxApi: "forbidden-redux-api",
  sharedSvelteStoreBoundary: "shared-svelte-store-boundary",
  sourceShapedPackageImport: "source-shaped-package-import",
  collectionStateShape: "collection-state-shape",
  collectionInternalMutation: "collection-internal-mutation",
  nonSerializableInitialState: "non-serializable-initial-state",
  nondeterministicReducerState: "nondeterministic-reducer-state",
  reducerSideEffect: "reducer-side-effect",
  asyncReducerHandler: "async-reducer-handler",
  componentLifecycleBoundary: "component-lifecycle-boundary",
  passThroughWrapper: "pass-through-wrapper",
  directSelectorCallMode: "direct-selector-call-mode",
  noExtraSelectorCaching: "no-extra-selector-caching",
  selectorArgumentStability: "selector-argument-stability",
  waitForNamedSelector: "wait-for-named-selector",
  typedSagaYieldStar: "typed-saga-yield-star",
  autoForkingChannelHelper: "auto-forking-channel-helper",
  rawChannelCleanup: "raw-channel-cleanup",
  storeConstructorSagaMap: "store-constructor-saga-map",
  stateTypeName: "state-type-name",
  selectorExportName: "selector-export-name",
  selectorFileName: "selector-file-name",
  actionTypeShape: "action-type-shape",
  camelcaseSliceIdentity: "camelcase-slice-identity",
  createActionOwner: "create-action-owner",
  testSelectorSelect: "test-selector-select",
  typedSagaCallMockGuard: "typed-saga-call-mock-guard",
};

const sourceRuleConfig = {
  ...architectureErrorRules(sourceBoundaryRulePlugins),
  ...architectureErrorRules(nativeReplacementRulePlugins),
  ...architectureErrorRules(stateCollectionReducerRulePlugins),
  ...architectureErrorRules(sagaSelectorChannelRulePlugins),
};

const testRuleConfig = architectureErrorRules(testPatternRulePlugins);

const defaultPaths = ["src"];
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".svelte", ".ts", ".tsx"]);
const ignoredDirectories = new Set([".git", "coverage", "dist", "node_modules"]);
const testFilePattern = /(^|[\\/])[^\\/]+\.(test|spec)\.[^\\/]+$/;
const selectorFactories = new Set(["createSelector"]);
const actionFactories = new Set(["createAction", "createAsyncAction"]);
const ownerModuleKinds = [
  { kind: "slice", pattern: /-slice\.[cm]?[jt]sx?$/, noun: "slice owner", suffix: "*-slice" },
  { kind: "selectors", pattern: /-selectors\.[cm]?[jt]sx?$/, noun: "selectors owner", suffix: "*-selectors" },
];
const createActionOwnerUtilityExceptionFiles = new Set([
  "src/utils/store/boolean-preference.ts",
  "src/utils/store/create-action.ts",
]);

function locationFor(source, index) {
  const before = source.slice(0, index);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function basename(path) {
  return normalizePath(path).split("/").pop() ?? path;
}

function directoryName(path) {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? "." : normalized.slice(0, slash);
}

function ownerModuleKind(file) {
  const name = basename(file);
  return ownerModuleKinds.find(({ pattern }) => pattern.test(name));
}

function normalizeEslintRuleId(ruleId) {
  return ruleId?.replace(/^architecture\//, "") ?? "parse-error";
}

function blankNonLineCharacters(source) {
  return source.replace(/[^\r\n]/g, " ");
}

function svelteScriptSource(source) {
  let output = "";
  let cursor = 0;
  const scriptPattern = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(source))) {
    const openEnd = source.indexOf(">", match.index) + 1;
    const closeStart = match.index + match[0].toLowerCase().lastIndexOf("</script>");
    const closeEnd = closeStart + "</script>".length;
    output += blankNonLineCharacters(source.slice(cursor, match.index));
    output += `// ${source.slice(match.index, openEnd)}`;
    output += source.slice(openEnd, closeStart);
    output += `// ${source.slice(closeStart, closeEnd)}`;
    cursor = closeEnd;
  }
  return output + blankNonLineCharacters(source.slice(cursor));
}

function sourceForEslint(file, source) {
  return file.endsWith(".svelte") ? svelteScriptSource(source) : source;
}

function createEslintDisableChecker(linter, file, source) {
  const cache = new Map();
  return (rule, line, column = 1) => {
    const key = `${rule}:${line}:${column}`;
    if (cache.has(key)) return cache.get(key);
    const probeRule = {
      meta: { type: "problem", schema: [] },
      create(context) {
        return { Program() { context.report({ loc: { line, column }, message: "architecture disable probe" }); } };
      },
    };
    const messages = linter.verify(
      sourceForEslint(file, source),
      [
        {
          files: ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx,svelte}"],
          linterOptions: { reportUnusedDisableDirectives: "off" },
          languageOptions: architectureLanguageOptions,
          plugins: { architecture: { rules: { [rule]: probeRule } } },
          rules: { [`architecture/${rule}`]: "error" },
        },
      ],
      { filename: file }
    );
    const disabled = !messages.some((message) => message.ruleId === `architecture/${rule}`);
    cache.set(key, disabled);
    return disabled;
  };
}

function isSvelteTopLevelSelectorReadableDiagnostic(file, source, diagnostic) {
  if (!file.endsWith(".svelte") || diagnostic.rule !== architectureRules.directSelectorCallMode) return false;
  const line = source.split(/\r?\n/)[diagnostic.line - 1] ?? "";
  return !/(?:function\*?\b|=>)/.test(line);
}

function isCreateActionOwnerUtilityException(file, diagnostic) {
  return diagnostic.rule === architectureRules.createActionOwner && createActionOwnerUtilityExceptionFiles.has(normalizePath(file));
}

function lintSource(linter, file, source, rules, { root } = {}) {
  return linter
    .verify(
      sourceForEslint(file, source),
      [
        {
          files: ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx,svelte}"],
          linterOptions: { reportUnusedDisableDirectives: "off" },
          languageOptions: architectureLanguageOptions,
          plugins: { architecture: architecturePlugin },
          ...(root ? { settings: { architectureRoot: root } } : {}),
          rules,
        },
      ],
      { filename: file }
    )
    .map((message) => ({
      rule: normalizeEslintRuleId(message.ruleId),
      file,
      line: message.line ?? 1,
      column: message.column ?? 1,
      message: message.message,
    }))
    .filter((diagnostic) => !isSvelteTopLevelSelectorReadableDiagnostic(file, source, diagnostic))
    .filter((diagnostic) => !isCreateActionOwnerUtilityException(file, diagnostic));
}

function isIdentifier(char) {
  return Boolean(char && /[A-Za-z0-9_$]/.test(char));
}

function skipQuoted(source, index) {
  const quote = source[index];
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function skipTrivia(source, index) {
  let cursor = index;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "/") {
      const nextLine = source.indexOf("\n", cursor + 2);
      cursor = nextLine === -1 ? source.length : nextLine + 1;
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "*") {
      const end = source.indexOf("*/", cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }
    return cursor;
  }
  return cursor;
}

function skipTypeArguments(source, index) {
  if (source[index] !== "<") return index;
  let depth = 0;
  let cursor = index;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "'" || char === '"' || char === "`") {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === "<") depth += 1;
    if (char === ">") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  return index;
}

function readBalanced(source, openIndex, openChar, closeChar) {
  let depth = 0;
  let cursor = openIndex;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "'" || char === '"' || char === "`") {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") {
      const nextLine = source.indexOf("\n", cursor + 2);
      cursor = nextLine === -1 ? source.length : nextLine + 1;
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      const end = source.indexOf("*/", cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { body: source.slice(openIndex + 1, cursor), end: cursor + 1 };
      }
    }
    cursor += 1;
  }
  return undefined;
}

function findCalls(source, names) {
  const calls = [];
  const nameSet = new Set(names);
  const pattern = /[A-Za-z_$][\w$]*/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[0];
    if (!nameSet.has(name) || isIdentifier(source[match.index - 1])) continue;
    let cursor = skipTrivia(source, match.index + name.length);
    if (source[cursor] === "<") cursor = skipTrivia(source, skipTypeArguments(source, cursor));
    if (source[cursor] !== "(") continue;
    const call = readBalanced(source, cursor, "(", ")");
    if (call) calls.push({ name, start: match.index, args: call.body, argsStart: cursor + 1, end: call.end });
  }
  return calls;
}

function splitTopLevelArguments(source) {
  const args = [];
  let start = 0;
  let depth = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "'" || char === '"' || char === "`") {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") {
      const nextLine = source.indexOf("\n", cursor + 2);
      cursor = nextLine === -1 ? source.length : nextLine + 1;
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      const end = source.indexOf("*/", cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }
    if ("({[".includes(char)) depth += 1;
    if (")}]".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      args.push({ text: source.slice(start, cursor), offset: start });
      start = cursor + 1;
    }
    cursor += 1;
  }
  args.push({ text: source.slice(start), offset: start });
  return args;
}

function leadingStringLiteral(argument) {
  const trimmedOffset = argument.text.search(/\S/);
  if (trimmedOffset === -1) return undefined;
  const text = argument.text.slice(trimmedOffset);
  const quote = text[0];
  if (!["'", '"', "`"].includes(quote)) return undefined;
  let value = "";
  for (let cursor = 1; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === "\\") {
      value += text[cursor + 1] ?? "";
      cursor += 1;
      continue;
    }
    if (char === quote) return { value, offset: argument.offset + trimmedOffset };
    if (quote === "`" && char === "$" && text[cursor + 1] === "{") return undefined;
    value += char;
  }
  return undefined;
}

function inferExportedConstName(source, callStart) {
  const prefix = source.slice(Math.max(0, callStart - 250), callStart);
  const match = prefix.match(/(?:^|[;\n])\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
  return match?.[1];
}

function inferConstName(source, callStart) {
  const prefix = source.slice(Math.max(0, callStart - 250), callStart);
  const match = prefix.match(/(?:^|[;\n])\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
  return match?.[1];
}

function removeComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function normalizeSelectorBody(factory, argument) {
  let body = removeComments(argument).trim();
  body = body.replace(/^\(?\s*([^)=]*)\s*\)?\s*=>\s*\{\s*return\s+([\s\S]*?);?\s*\}$/m, "($1)=>$2");
  body = body.replace(/\s+/g, "").replace(/;$/, "");
  return `${factory}:${body}`;
}

function pushRecord(records, rule, file, source, index, key, label) {
  const location = locationFor(source, index);
  if (records.isDisabled(rule, location.line, location.column)) return;
  records[rule].push({ key, file, line: location.line, column: location.column, label });
}

function extractTopLevelProperties(body, startLine) {
  const properties = [];
  let depth = 0;
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = depth === 0 ? line.match(/^\s*([A-Za-z_$][\w$]*|["'][^"']+["'])\??\s*:/) : undefined;
    if (match) {
      properties.push({ name: match[1].replace(/^['"]|['"]$/g, ""), line: startLine + index });
    }
    const cleanLine = removeComments(line).replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "");
    for (const char of cleanLine) {
      if ("({[".includes(char)) depth += 1;
      if (")}]".includes(char)) depth = Math.max(0, depth - 1);
    }
  }
  return properties;
}

function extractTopLevelSagaRegistrations(body, startLine) {
  const registrations = [];
  let depth = 0;
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = depth === 0 ? line.match(/^\s*(["']?)([A-Za-z_$][\w$/-]*)\1\s*:\s*([A-Za-z_$][\w$]*Saga)\b/) : undefined;
    if (match) {
      registrations.push({ name: match[2], saga: match[3], line: startLine + index, column: line.indexOf(match[2]) + 1 });
    }
    const cleanLine = removeComments(line).replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "");
    for (const char of cleanLine) {
      if ("({[".includes(char)) depth += 1;
      if (")}]".includes(char)) depth = Math.max(0, depth - 1);
    }
  }
  return registrations;
}

function suspiciousStateReason(field) {
  if (/^(filtered|sorted|visible|displayed|derived|computed|matching)[A-Z_]/.test(field)) {
    return "looks derived from another collection; keep it in a selector unless it is source data";
  }
  if (/(Filtered|Sorted|Visible|Displayed|Derived|Computed|Matching)[A-Z_]/.test(field)) {
    return "looks derived from another state value; keep it in a selector unless it is source data";
  }
  if (/(Count|Total)$/.test(field) && field !== "count") {
    return "looks like an aggregate that should usually be derived by a selector";
  }
  return undefined;
}

function normalizedStateConcept(field) {
  let concept = field.replace(/^(filtered|sorted|visible|displayed|selected|all)/i, "");
  concept = concept.replace(/(ById|Ids|Map|List|Array|Items|Collection|Count|Total)$/i, "");
  concept = concept.toLowerCase().replace(/s$/, "");
  return concept.length >= 3 ? concept : undefined;
}

function hasDuplicatingStateToken(field) {
  return /^(filtered|sorted|visible|displayed|selected|all)/i.test(field) || /(ById|Ids|Map|List|Array|Items|Count|Total)$/i.test(field);
}

function analyzeStateShape(records, file, source, shapeName, properties) {
  const seenNames = new Map();
  const concepts = new Map();
  for (const property of properties) {
    const reason = suspiciousStateReason(property.name);
    if (reason && !records.isDisabled(architectureRules.suspiciousStateField, property.line)) {
      records.diagnostics.push({
        rule: architectureRules.suspiciousStateField,
        file,
        line: property.line,
        column: 1,
        message: `Suspicious Redux state field "${property.name}" in ${shapeName}: ${reason}.`,
      });
    }
    const existingName = seenNames.get(property.name);
    if (existingName && !records.isDisabled(architectureRules.duplicateStateField, property.line)) {
      records.diagnostics.push({
        rule: architectureRules.duplicateStateField,
        file,
        line: property.line,
        column: 1,
        message: `Duplicate Redux state field "${property.name}" in ${shapeName}.`,
      });
    }
    seenNames.set(property.name, property);

    const concept = normalizedStateConcept(property.name);
    const previous = concept ? concepts.get(concept) : undefined;
    if (previous && (hasDuplicatingStateToken(previous.name) || hasDuplicatingStateToken(property.name))) {
      if (!records.isDisabled(architectureRules.duplicateStateField, property.line)) {
        records.diagnostics.push({
          rule: architectureRules.duplicateStateField,
          file,
          line: property.line,
          column: 1,
          message: `Redux state fields "${previous.name}" and "${property.name}" in ${shapeName} look like duplicated representations; keep one source of truth and derive the other in selectors.`,
        });
      }
    } else if (concept) {
      concepts.set(concept, property);
    }
  }
}

function analyzeSource(linter, file, source) {
  const records = {
    diagnostics: [],
    [architectureRules.duplicateActionType]: [],
    [architectureRules.duplicateSelectorExport]: [],
    [architectureRules.duplicateSelectorImplementation]: [],
    [architectureRules.duplicateSagaName]: [],
    [architectureRules.duplicateSagaRegistration]: [],
    [architectureRules.singleSliceSelectorsModule]: [],
    isDisabled: createEslintDisableChecker(linter, file, source),
  };

  const ownerKind = ownerModuleKind(file);
  if (ownerKind && !records.isDisabled(architectureRules.singleSliceSelectorsModule, 1, 1)) {
    const directory = directoryName(file);
    records[architectureRules.singleSliceSelectorsModule].push({
      key: `${ownerKind.kind}:${directory}`,
      kind: ownerKind.kind,
      noun: ownerKind.noun,
      suffix: ownerKind.suffix,
      directory,
      file,
      line: 1,
      column: 1,
      label: basename(file),
    });
  }

  for (const call of findCalls(source, actionFactories)) {
    const args = splitTopLevelArguments(call.args);
    const actionTypeArgs = call.name === "createAsyncAction" ? args.slice(0, 2) : args.slice(0, 1);
    for (const argument of actionTypeArgs) {
      const literal = leadingStringLiteral(argument);
      if (!literal) continue;
      const index = call.argsStart + literal.offset;
      pushRecord(records, architectureRules.duplicateActionType, file, source, index, literal.value, inferConstName(source, call.start) ?? call.name);
    }
  }

  for (const call of findCalls(source, selectorFactories)) {
    const selectorName = inferExportedConstName(source, call.start);
    if (!selectorName) continue;
    const args = splitTopLevelArguments(call.args);
    const firstArg = args[0]?.text;
    pushRecord(records, architectureRules.duplicateSelectorExport, file, source, call.start, selectorName, selectorName);
    if (firstArg) {
      pushRecord(
        records,
        architectureRules.duplicateSelectorImplementation,
        file,
        source,
        call.argsStart + args[0].offset,
        normalizeSelectorBody(call.name, firstArg),
        selectorName
      );
    }
  }

  for (const pattern of [/(?:export\s+)?function\s*\*\s*([A-Za-z_$][\w$]*Saga)\s*\(/g, /(?:export\s+)?const\s+([A-Za-z_$][\w$]*Saga)\s*=\s*(?:function\s*)?\*/g]) {
    let match;
    while ((match = pattern.exec(source))) {
      pushRecord(records, architectureRules.duplicateSagaName, file, source, match.index, match[1], match[1]);
    }
  }

  for (const call of findCalls(source, ["addSaga"])) {
    const literal = leadingStringLiteral(splitTopLevelArguments(call.args)[0] ?? { text: "", offset: 0 });
    if (literal) {
      pushRecord(records, architectureRules.duplicateSagaRegistration, file, source, call.argsStart + literal.offset, literal.value, "addSaga registration");
    }
  }

  const sagaRegistryPattern = /(?:const|let|var)\s+(sagas|[A-Za-z_$][\w$]*(?:sagas|sagaRegistry))\s*(?::[^=]+)?=\s*\{/gi;
  let registrationMatch;
  while ((registrationMatch = sagaRegistryPattern.exec(source))) {
    const openIndex = source.indexOf("{", registrationMatch.index);
    const registry = readBalanced(source, openIndex, "{", "}");
    if (!registry) continue;
    for (const entry of extractTopLevelSagaRegistrations(registry.body, locationFor(source, openIndex + 1).line)) {
      if (records.isDisabled(architectureRules.duplicateSagaRegistration, entry.line, entry.column)) continue;
      records[architectureRules.duplicateSagaRegistration].push({
        key: entry.name,
        file,
        line: entry.line,
        column: entry.column,
        label: `${entry.name}: ${entry.saga}`,
      });
    }
  }

  for (const pattern of [/export\s+type\s+([A-Za-z_$][\w$]*State)\s*=\s*\{/g, /export\s+interface\s+([A-Za-z_$][\w$]*State)\s*\{/g]) {
    let match;
    while ((match = pattern.exec(source))) {
      const openIndex = source.indexOf("{", match.index);
      const shape = readBalanced(source, openIndex, "{", "}");
      if (!shape) continue;
      analyzeStateShape(records, file, source, match[1], extractTopLevelProperties(shape.body, locationFor(source, openIndex + 1).line));
    }
  }

  const initialStatePattern = /const\s+([A-Za-z_$][\w$]*initialState|initialState)\s*(?::[^=]+)?=\s*\{/gi;
  let initialStateMatch;
  while ((initialStateMatch = initialStatePattern.exec(source))) {
    const openIndex = source.indexOf("{", initialStateMatch.index);
    const shape = readBalanced(source, openIndex, "{", "}");
    if (!shape) continue;
    analyzeStateShape(records, file, source, initialStateMatch[1], extractTopLevelProperties(shape.body, locationFor(source, openIndex + 1).line));
  }

  return records;
}

async function collectFiles(root, paths, options = {}) {
  const files = [];
  async function visit(absolutePath) {
    const stat = await lstat(absolutePath);
    if (stat.isDirectory()) {
      if (ignoredDirectories.has(absolutePath.split(/[\\/]/).pop())) return;
      const entries = await readdir(absolutePath);
      await Promise.all(entries.map((entry) => visit(join(absolutePath, entry))));
      return;
    }
    const relativePath = normalizePath(relative(root, absolutePath));
    const isTestFile = testFilePattern.test(relativePath);
    if (!sourceExtensions.has(extname(absolutePath)) || (!options.onlyTests && isTestFile) || (options.onlyTests && !isTestFile)) return;
    files.push(absolutePath);
  }
  for (const path of paths) await visit(resolve(root, path));
  return files.sort();
}

function duplicateDiagnostics(rule, records, noun, guidance) {
  const grouped = new Map();
  for (const record of records) {
    const group = grouped.get(record.key) ?? [];
    group.push(record);
    grouped.set(record.key, group);
  }
  return [...grouped.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      rule,
      file: group[0].file,
      line: group[0].line,
      column: group[0].column,
      message: `Duplicate ${noun} "${key}" found in ${group.length} places. ${guidance}`,
      locations: group.map(({ file, line, column, label }) => ({ file, line, column, label })),
    }));
}

function ownerModuleDiagnostics(records) {
  const grouped = new Map();
  for (const record of records) {
    const group = grouped.get(record.key) ?? [];
    group.push(record);
    grouped.set(record.key, group);
  }
  return [...grouped.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const first = group[0];
      const modules = group.map(({ label }) => label).join(", ");
      return {
        rule: architectureRules.singleSliceSelectorsModule,
        file: first.file,
        line: first.line,
        column: first.column,
        message: `Slice directory "${first.directory}" contains ${group.length} ${first.noun} modules (${modules}). Keep one ${first.suffix} module per slice directory and split multiple slices into separate directories named after the slices.`,
        locations: group.map(({ file, line, column, label }) => ({ file, line, column, label })),
      };
    });
}

export async function validateArchitecture(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const paths = options.paths ?? defaultPaths;
  const linter = new Linter();
  const files = await collectFiles(root, paths);
  const testFiles = await collectFiles(root, paths, { onlyTests: true });
  const aggregate = {
    files: files.map((file) => normalizePath(relative(root, file))),
    testFiles: testFiles.map((file) => normalizePath(relative(root, file))),
    diagnostics: [],
    [architectureRules.duplicateActionType]: [],
    [architectureRules.duplicateSelectorExport]: [],
    [architectureRules.duplicateSelectorImplementation]: [],
    [architectureRules.duplicateSagaName]: [],
    [architectureRules.duplicateSagaRegistration]: [],
    [architectureRules.singleSliceSelectorsModule]: [],
  };

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relativePath = normalizePath(relative(root, file));
    const records = analyzeSource(linter, relativePath, source);
    aggregate.diagnostics.push(...records.diagnostics);
    aggregate.diagnostics.push(...lintSource(linter, relativePath, source, sourceRuleConfig, { root }));
    for (const rule of Object.values(architectureRules)) {
      if (records[rule]) aggregate[rule].push(...records[rule]);
    }
  }

  for (const file of testFiles) {
    const source = await readFile(file, "utf8");
    const relativePath = normalizePath(relative(root, file));
    aggregate.diagnostics.push(...lintSource(linter, relativePath, source, testRuleConfig, { root }));
  }

  aggregate.diagnostics.push(
    ...duplicateDiagnostics(architectureRules.duplicateActionType, aggregate[architectureRules.duplicateActionType], "action type string", "Action types must be globally unique."),
    ...duplicateDiagnostics(architectureRules.duplicateSelectorExport, aggregate[architectureRules.duplicateSelectorExport], "selector export", "Give each selector a unique exported name."),
    ...duplicateDiagnostics(architectureRules.duplicateSelectorImplementation, aggregate[architectureRules.duplicateSelectorImplementation], "selector implementation", "Reuse the existing selector or make the derivation distinct."),
    ...duplicateDiagnostics(architectureRules.duplicateSagaName, aggregate[architectureRules.duplicateSagaName], "saga function name", "Rename one saga or reuse the existing implementation."),
    ...duplicateDiagnostics(architectureRules.duplicateSagaRegistration, aggregate[architectureRules.duplicateSagaRegistration], "saga registration", "Each saga registry key/name must be unique within the validation scope."),
    ...ownerModuleDiagnostics(aggregate[architectureRules.singleSliceSelectorsModule])
  );

  aggregate.diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return aggregate;
}

const colorCodes = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};
const diagnosticLabelWidth = "How to fix:".length + 2;
const architectureRuleDetails = Object.fromEntries(
  Object.entries(architectureRulePlugins).map(([ruleId, plugin]) => [ruleId, plugin.rules?.[ruleId]?.meta?.architecture ?? {}])
);

function colorText(text, code, enabled) {
  return enabled ? `${code}${text}${colorCodes.reset}` : text;
}

function hasEnabledForceColor(env) {
  const value = env.FORCE_COLOR;
  return value != null && value !== "" && !/^(?:0|false|no)$/i.test(String(value));
}

function hasDisabledColor(env) {
  return /^(?:0|false|no)$/i.test(String(env.FORCE_COLOR ?? "")) || env.NO_COLOR != null || env.TERM === "dumb";
}

export function shouldColorizeDiagnostics({ env = process.env, stream = process.stdout } = {}) {
  if (hasEnabledForceColor(env)) return true;
  if (hasDisabledColor(env)) return false;
  return Boolean(stream?.isTTY || env.CI);
}

function formatDiagnosticField(label, value, color) {
  if (!value) return undefined;
  const rawLabel = `${label}:`.padEnd(diagnosticLabelWidth);
  const prefix = `  ${rawLabel}`;
  const continuation = " ".repeat(prefix.length);
  const lines = String(value).split(/\r?\n/);
  const formattedValue = lines.map((line, index) => (index === 0 ? line : `${continuation}${line}`)).join("\n");
  return `  ${colorText(rawLabel, colorCodes.yellow, color)}${formattedValue}`;
}

function formatRelatedLocations(locations = []) {
  if (locations.length === 0) return undefined;
  return [`  Locations:`, ...locations.map((location) => `    - ${location.file}:${location.line}:${location.column}${location.label ? ` ${location.label}` : ""}`)].join("\n");
}

export function formatDiagnostics(diagnostics, options = {}) {
  const color = options.color ?? shouldColorizeDiagnostics();
  if (diagnostics.length === 0) return "[architecture-validation] no architecture gate violations found";
  return diagnostics
    .map((diagnostic, index) => {
      const location = `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`;
      const details = architectureRuleDetails[diagnostic.rule] ?? {};
      return [
        `${index + 1}. ${colorText(location, `${colorCodes.bold}${colorCodes.cyan}`, color)}`,
        formatDiagnosticField("Rule", diagnostic.rule, color),
        formatDiagnosticField("Problem", diagnostic.message, color),
        formatDiagnosticField("Why", details.why, color),
        formatDiagnosticField("How to fix", details.fix, color),
        formatRelatedLocations(diagnostic.locations),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function parseCliArgs(argv) {
  const options = { paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[++index];
    } else if (arg === "--json") {
      options.json = true;
    } else {
      options.paths.push(arg);
    }
  }
  if (options.paths.length === 0) delete options.paths;
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const result = await validateArchitecture(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatDiagnostics(result.diagnostics, { color: shouldColorizeDiagnostics() }));
    const testFileCount = result.testFiles?.length ?? 0;
    const testFileSummary = testFileCount > 0 ? ` and ${testFileCount} test files` : "";
    console.log(`[architecture-validation] scanned ${result.files.length} source files${testFileSummary}`);
  }
  return result.diagnostics.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await main();
  process.exit(exitCode);
}