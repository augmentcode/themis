import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { parse } from "@babel/parser";
import { calleeIdentifierName, staticString, traverse, typeName } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "non-serializable-state-type";

const forbiddenTypes = new Set(["Date", "Map", "Set", "WeakMap", "WeakSet", "RegExp", "Promise", "Function", "Error", "Symbol"]);
const sourceExtensions = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const importedModuleCache = new Map();

function stateMembers(declaration, declarations, seen = new Set()) {
  if (!declaration || seen.has(declaration)) return [];
  seen.add(declaration);
  if (declaration.type === "TSInterfaceDeclaration") return declaration.body.body;
  if (declaration.typeAnnotation?.type === "TSTypeLiteral") return declaration.typeAnnotation.members;
  if (declaration.typeAnnotation?.type === "TSTypeReference") return stateMembers(declarations?.get(typeName(declaration.typeAnnotation)), declarations, seen);
  if (declaration.typeAnnotation?.type === "TSIntersectionType") {
    return declaration.typeAnnotation.types.flatMap((typeNode) => (typeNode.type === "TSTypeLiteral" ? typeNode.members : stateMembers(declarations?.get(typeName(typeNode)), declarations, seen)));
  }
  return [];
}

function typeArguments(node) {
  return node.typeArguments?.params ?? node.typeParameters?.params ?? [];
}

function isStateDeclaration(node) {
  return ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"].includes(node?.type) && node.id?.type === "Identifier";
}

function stateDeclarationName(typeNode) {
  if (typeNode?.type !== "TSTypeReference") return undefined;
  return typeName(typeNode);
}

function localStateType(typeNode, declarations) {
  if (typeNode?.type === "TSTypeLiteral") return { members: typeNode.members, label: "inline type literal", key: typeNode };

  const declaration = declarations.get(stateDeclarationName(typeNode));
  if (!declaration) return undefined;

  return { members: stateMembers(declaration, declarations), label: declaration.id.name, key: declaration };
}

function importRecords(program) {
  const imports = new Map();
  for (const statement of program.body ?? []) {
    if (statement.type !== "ImportDeclaration") continue;
    const source = staticString(statement.source);
    if (!source?.startsWith(".")) continue;

    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type !== "ImportSpecifier" || specifier.local?.type !== "Identifier") continue;
      imports.set(specifier.local.name, { source, importedName: specifier.imported?.name ?? staticString(specifier.imported) });
    }
  }
  return imports;
}

function collectStateDeclarations(program) {
  const declarations = new Map();
  traverse(program, {
    "*"(node) {
      if (isStateDeclaration(node)) declarations.set(node.id.name, node);
    },
  });
  return declarations;
}

function parseTypeScriptModule(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx", "estree"], errorRecovery: true });
  return ast.program ?? ast;
}

function fileExists(path) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolveImportedFile(source, filename, root) {
  if (!source?.startsWith(".")) return undefined;
  const containingFile = isAbsolute(filename) ? filename : root ? resolve(root, filename) : resolve(filename);
  const base = resolve(dirname(containingFile), source);
  const candidates = extname(base)
    ? [base]
    : [...sourceExtensions.map((extension) => `${base}${extension}`), ...sourceExtensions.map((extension) => join(base, `index${extension}`))];
  return candidates.find(fileExists);
}

function importedModule(source, filename, root) {
  const filePath = resolveImportedFile(source, filename, root);
  if (!filePath) return undefined;
  if (importedModuleCache.has(filePath)) return importedModuleCache.get(filePath);

  try {
    const program = parseTypeScriptModule(readFileSync(filePath, "utf8"));
    const module = { filePath, declarations: collectStateDeclarations(program), imports: importRecords(program) };
    importedModuleCache.set(filePath, module);
    return module;
  } catch {
    importedModuleCache.set(filePath, undefined);
    return undefined;
  }
}

function importedStateType(typeNode, imports, filename, root) {
  const importRecord = imports.get(stateDeclarationName(typeNode));
  if (!importRecord?.importedName) return undefined;

  const module = importedModule(importRecord.source, filename, root);
  const declaration = module?.declarations.get(importRecord.importedName);
  if (!declaration) return undefined;

  return {
    members: stateMembers(declaration, module.declarations),
    label: declaration.id.name,
    key: `${module.filePath}:${declaration.id.name}`,
    declarations: module.declarations,
  };
}

function propertyName(member) {
  return member.key?.name ?? staticString(member.key);
}

function propertyTypeNode(member) {
  return member.typeAnnotation?.typeAnnotation;
}

function findForbiddenType(typeNode, declarations, seen = new Set()) {
  let forbidden;

  // Walk the whole TypeScript annotation so nested Array<Map<...>> and function signatures are caught.
  traverse(typeNode, {
    TSTypeReference(child) {
      const name = typeName(child);
      if (forbiddenTypes.has(name)) forbidden = child;
      const declaration = declarations?.get(name);
      if (!forbidden && declaration && !seen.has(declaration)) forbidden = findForbiddenInDeclaration(declaration, declarations, seen);
    },
    TSFunctionType(child) {
      forbidden ??= child;
    },
  });

  return forbidden;
}

function findForbiddenInDeclaration(declaration, declarations, seen) {
  if (!declaration || seen.has(declaration)) return undefined;
  seen.add(declaration);
  if (declaration.type === "TSInterfaceDeclaration") {
    for (const member of declaration.body.body) {
      const forbidden = findForbiddenType(propertyTypeNode(member), declarations, seen);
      if (forbidden) return forbidden;
    }
    return undefined;
  }
  return findForbiddenType(declaration.typeAnnotation, declarations, seen);
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Redux state type includes a non-serializable field.",
  why: "Canonical Redux state must stay JSON-serializable so it can be persisted, replayed, inspected, and compared predictably.",
  fix: "Store plain values such as strings, numbers, booleans, arrays, or records; convert Date/Map/Set/Error/Promise/function values at the boundary.",
  create(context, { classifyPath, report }) {
    if (!classifyPath().isStateOwner) return {};
    const filename = context.filename ?? context.getFilename?.() ?? "";
    const root = context.settings?.architectureRoot;

    return {
      Program(program) {
        const declarations = collectStateDeclarations(program);
        const imports = importRecords(program);
        const reducerCalls = [];

        traverse(program, {
          "*"(node) {
            if (node.type === "CallExpression" && calleeIdentifierName(node) === "createReducer") reducerCalls.push(node);
          },
        });

        const checkedTypes = new Set();
        for (const reducerCall of reducerCalls) {
          const genericType = typeArguments(reducerCall)[0];
          const stateType = localStateType(genericType, declarations) ?? importedStateType(genericType, imports, filename, root);
          if (!stateType || checkedTypes.has(stateType.key)) continue;
          checkedTypes.add(stateType.key);

          for (const member of stateType.members) {
            const forbidden = findForbiddenType(propertyTypeNode(member), stateType.declarations);
            if (!forbidden) continue;

            report({
              node: stateType.declarations ? genericType : forbidden,
              summary: `Redux state field "${propertyName(member) ?? "unknown"}" uses non-serializable type "${typeName(forbidden)}" in ${stateType.label}; store a plain serializable representation instead.`,
            });
          }
        }
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/non-serializable-state-type`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
