import { fileURLToPath } from "node:url";

export function unwrapExpression(node) {
  let current = node;
  while (["ChainExpression", "TSAsExpression", "TSTypeAssertion", "TSNonNullExpression", "TSInstantiationExpression"].includes(current?.type)) current = current.expression;
  return current;
}

export function staticPropertyName(node) {
  if (node?.type === "Identifier" || node?.type === "PrivateIdentifier") return node.name;
  if (node?.type === "Literal") return String(node.value);
  return undefined;
}

export function staticString(node) {
  const value = unwrapExpression(node);
  if (value?.type === "Literal" && typeof value.value === "string") return value.value;
  if (value?.type === "TemplateLiteral" && value.expressions.length === 0) return value.quasis[0]?.value?.cooked ?? value.quasis[0]?.value?.raw;
  return undefined;
}

export function isSelectorModuleImportSource(sourcePath = "") {
  const segments = String(sourcePath).replace(/\\/g, "/").split("/").filter(Boolean);
  const directoryName = segments[segments.length - 2];
  const fileStem = segments[segments.length - 1]?.replace(/\.[cm]?[jt]sx?$/, "");
  return Boolean(directoryName && fileStem === `${directoryName}-selectors`);
}

function isSelectorIdentifierName(name) {
  return typeof name === "string" && name.startsWith("select");
}

function isSelectorImportSpecifier(specifier) {
  return [staticPropertyName(specifier?.imported), specifier?.local?.name].some(isSelectorIdentifierName);
}

function isRuntimeImportSpecifier(declaration, specifier) {
  return ![declaration?.importKind, specifier?.importKind].some((kind) => kind === "type" || kind === "typeof");
}

const storeConstructorByImportSource = new Map([
  ["@augmentcode/themis/svelte-store", "Store"],
  ["@augmentcode/themis/react-store", "ReactStore"],
  ["@augmentcode/themis/streaming-store", "StreamingStore"],
]);

const storeTypeDeclarationFiles = new Map([
  ["Store", ["../src/svelte-store.ts", "../dist/svelte-store.d.ts"]],
  ["ReactStore", ["../src/react-store.ts", "../dist/react-store.d.ts"]],
  ["StreamingStore", ["../src/streaming-store.ts", "../dist/streaming-store.d.ts"]],
].map(([name, paths]) => [name, new Set(paths.map((path) => fileURLToPath(new URL(path, import.meta.url)).replace(/\\/g, "/")))]));

function staticMemberPropertyName(node) {
  if (node?.type !== "MemberExpression" && node?.type !== "Property") return undefined;
  return node.computed ? staticString(node.property ?? node.key) : staticPropertyName(node.property ?? node.key);
}

export function createStoreCreateSelectorTracker(sourceCode) {
  const constructorVariables = new WeakMap();
  const instanceVariables = new WeakMap();
  const selectorVariables = new WeakMap();
  const parserServices = sourceCode?.parserServices;
  const typeChecker = parserServices?.program?.getTypeChecker?.();
  const estreeToTypeScriptNode = parserServices?.esTreeNodeToTSNodeMap;

  function hasRecognizedStoreDeclaration(symbol) {
    const expectedFiles = storeTypeDeclarationFiles.get(symbol?.getName?.());
    return Boolean(expectedFiles && symbol.getDeclarations?.()?.some((declaration) => {
      const fileName = declaration.getSourceFile?.()?.fileName?.replace(/\\/g, "/");
      return expectedFiles.has(fileName);
    }));
  }

  function isRecognizedStoreType(type, seen = new Set()) {
    if (!type || seen.has(type)) return false;
    seen.add(type);
    if (type.isUnion?.()) return type.types.every((part) => isRecognizedStoreType(part, seen));
    if (type.isIntersection?.()) return type.types.some((part) => isRecognizedStoreType(part, seen));

    const symbols = [type.aliasSymbol, type.getSymbol?.(), type.symbol, type.target?.symbol];
    if (symbols.some(hasRecognizedStoreDeclaration)) return true;
    return type.getBaseTypes?.()?.some((baseType) => isRecognizedStoreType(baseType, seen)) ?? false;
  }

  function hasRecognizedStoreType(node) {
    const current = unwrapExpression(node);
    const typeScriptNode = estreeToTypeScriptNode?.get?.(current);
    if (!typeChecker || !typeScriptNode) return false;
    try {
      return isRecognizedStoreType(typeChecker.getTypeAtLocation(typeScriptNode));
    } catch {
      return false;
    }
  }

  function variableForIdentifier(node) {
    const current = unwrapExpression(node);
    if (current?.type !== "Identifier" || !sourceCode?.getScope) return undefined;
    for (let scope = sourceCode.getScope(current); scope; scope = scope.upper) {
      const variable = scope.set?.get(current.name);
      if (variable) return variable;
    }
    return undefined;
  }

  function classifyVariable(variable, cache, classify) {
    if (!variable) return false;
    const cached = cache.get(variable);
    if (cached !== undefined) return cached;
    cache.set(variable, false);
    const result = classify(variable);
    cache.set(variable, result);
    return result;
  }

  function isStoreConstructorVariable(variable) {
    return classifyVariable(variable, constructorVariables, (current) => current.defs?.some((definition) => {
      const specifier = definition.node;
      const declaration = specifier?.parent ?? definition.parent;
      const expectedName = storeConstructorByImportSource.get(staticString(declaration?.source));
      return (
        declaration?.type === "ImportDeclaration" &&
        specifier?.type === "ImportSpecifier" &&
        isRuntimeImportSpecifier(declaration, specifier) &&
        staticPropertyName(specifier.imported) === expectedName
      );
    }) ?? false);
  }

  function isStoreConstructorIdentifier(node) {
    return isStoreConstructorVariable(variableForIdentifier(node));
  }

  function isStoreInstanceVariable(variable) {
    return classifyVariable(variable, instanceVariables, (current) => current.defs?.some((definition) => {
      const declaration = definition.node;
      const initializer = unwrapExpression(declaration?.init);
      return (
        declaration?.type === "VariableDeclarator" &&
        declaration.id?.type === "Identifier" &&
        declaration.id.name === current.name &&
        initializer?.type === "NewExpression" &&
        isStoreConstructorIdentifier(initializer.callee)
      );
    }) ?? false);
  }

  function isStoreInstanceIdentifier(node) {
    return isStoreInstanceVariable(variableForIdentifier(node)) || hasRecognizedStoreType(node);
  }

  function isStoreCreateSelectorMember(node) {
    const current = unwrapExpression(node);
    return (
      current?.type === "MemberExpression" &&
      staticMemberPropertyName(current) === "createSelector" &&
      isStoreInstanceIdentifier(current.object)
    );
  }

  function patternBindsSelector(pattern, variableName) {
    if (pattern?.type !== "ObjectPattern") return false;
    return pattern.properties?.some((property) => {
      if (property?.type !== "Property" || staticMemberPropertyName(property) !== "createSelector") return false;
      const value = property.value?.type === "AssignmentPattern" ? property.value.left : property.value;
      return value?.type === "Identifier" && value.name === variableName;
    }) ?? false;
  }

  function isStoreCreateSelectorVariable(variable) {
    return classifyVariable(variable, selectorVariables, (current) => current.defs?.some((definition) => {
      const declaration = definition.node;
      if (declaration?.type !== "VariableDeclarator") return false;
      if (declaration.id?.type === "Identifier" && declaration.id.name === current.name) {
        const initializer = unwrapExpression(declaration.init);
        return isStoreCreateSelectorMember(initializer) || isStoreCreateSelectorIdentifier(initializer);
      }
      return patternBindsSelector(declaration.id, current.name) && isStoreInstanceIdentifier(declaration.init);
    }) ?? false);
  }

  function isStoreCreateSelectorIdentifier(node) {
    return isStoreCreateSelectorVariable(variableForIdentifier(node));
  }

  function isStoreCreateSelectorCallee(node) {
    const current = unwrapExpression(node);
    return isStoreCreateSelectorMember(current) || isStoreCreateSelectorIdentifier(current);
  }

  function isStoreCreateSelectorCall(node) {
    const current = unwrapExpression(node);
    return current?.type === "CallExpression" && isStoreCreateSelectorCallee(current.callee);
  }

  return {
    isStoreConstructorIdentifier,
    isStoreInstanceIdentifier,
    isStoreCreateSelectorMember,
    isStoreCreateSelectorIdentifier,
    isStoreCreateSelectorCallee,
    isStoreCreateSelectorCall,
  };
}

export function createImportedSelectorTracker() {
  const importedSelectorLocals = new Set();

  function recordImportDeclaration(node) {
    if (node?.type !== "ImportDeclaration") return;
    if (!isSelectorModuleImportSource(staticString(node.source) ?? "")) return;

    for (const specifier of node.specifiers ?? []) {
      if (
        specifier.type === "ImportSpecifier" &&
        isRuntimeImportSpecifier(node, specifier) &&
        specifier.local?.type === "Identifier" &&
        isSelectorImportSpecifier(specifier)
      ) {
        importedSelectorLocals.add(specifier.local.name);
      }
    }
  }

  function hasImportedSelectorLocal(name) {
    return importedSelectorLocals.has(name);
  }

  function isImportedSelectorIdentifier(node) {
    const current = unwrapExpression(node);
    return current?.type === "Identifier" && hasImportedSelectorLocal(current.name);
  }

  function isImportedSelectorCallee(node) {
    return isImportedSelectorIdentifier(unwrapExpression(node?.callee));
  }

  return { importedSelectorLocals, recordImportDeclaration, hasImportedSelectorLocal, isImportedSelectorIdentifier, isImportedSelectorCallee };
}

export function calleeIdentifierName(node) {
  const callee = unwrapExpression(node?.callee);
  return callee?.type === "Identifier" ? callee.name : undefined;
}

export function memberPropertyName(node) {
  const member = unwrapExpression(node);
  return member?.type === "MemberExpression" ? staticPropertyName(member.property) : undefined;
}

export function memberObjectName(node) {
  const member = unwrapExpression(node);
  const object = unwrapExpression(member?.object);
  return object?.type === "Identifier" ? object.name : undefined;
}

export function memberPath(node) {
  const current = unwrapExpression(node);
  if (current?.type === "Identifier") return current.name;
  if (current?.type === "ThisExpression") return "this";
  if (current?.type !== "MemberExpression") return undefined;
  const object = memberPath(current.object);
  const property = staticPropertyName(current.property);
  return object && property ? `${object}.${property}` : property;
}

export function isCallNamed(node, names) {
  return node?.type === "CallExpression" && names.has(calleeIdentifierName(node));
}

export function isFunctionNode(node) {
  return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node?.type);
}

export function traverse(node, visitors, parent = undefined) {
  if (!node || typeof node !== "object") return;
  const enter = visitors[node.type] ?? visitors["*"];
  const state = enter?.(node, parent) ?? undefined;
  for (const [key, value] of Object.entries(node)) {
    if (["parent", "tokens", "comments", "loc", "range"].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) traverse(child, visitors, node);
    } else if (value?.type) {
      traverse(value, visitors, node);
    }
  }
  visitors[`${node.type}:exit`]?.(node, parent, state);
}

export function exportedDeclaration(node) {
  return node?.type === "ExportNamedDeclaration" ? node.declaration : undefined;
}

export function objectPropertyName(node) {
  if (node?.type === "Property" || node?.type === "PropertyDefinition" || node?.type === "TSPropertySignature") return staticPropertyName(node.key);
  return undefined;
}

export function typeName(node) {
  const current = unwrapExpression(node);
  if (!current) return undefined;
  if (current.type === "TSTypeReference") return memberPath(current.typeName);
  if (current.type === "TSArrayType") return `${typeName(current.elementType) ?? "unknown"}[]`;
  if (current.type === "TSUnionType") return current.types.map(typeName).filter(Boolean).join("|");
  if (current.type === "TSLiteralType") return String(current.literal?.value ?? "");
  if (current.type === "TSStringKeyword") return "string";
  if (current.type === "TSNumberKeyword") return "number";
  if (current.type === "TSBooleanKeyword") return "boolean";
  if (current.type === "TSBigIntKeyword") return "bigint";
  if (current.type === "TSSymbolKeyword") return "symbol";
  if (current.type === "TSNullKeyword") return "null";
  if (current.type === "TSUndefinedKeyword") return "undefined";
  if (current.type === "TSFunctionType") return "Function";
  return current.type;
}

export function arrayElementTypeName(node) {
  const current = unwrapExpression(node);
  if (current?.type === "TSArrayType") return typeName(current.elementType);
  if (current?.type !== "TSTypeReference") return undefined;
  const name = typeName(current.typeName);
  if (!["Array", "ReadonlyArray"].includes(name)) return undefined;
  return typeName(current.typeArguments?.params?.[0] ?? current.typeParameters?.params?.[0]);
}

export function reportProgram(report, sourceCode, summary) {
  const program = sourceCode.ast ?? sourceCode;
  const first = program.body?.[0];
  report({ node: first ?? program, summary });
}
