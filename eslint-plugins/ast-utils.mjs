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
