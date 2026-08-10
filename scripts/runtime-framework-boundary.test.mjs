import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(root, "src");
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"];
const adapterFiles = new Set(["src/react-store.ts", "src/svelte-store.ts"]);
const adapterDirectories = [
  "src/components-react/",
  "src/components-svelte/",
  "src/utils/react-selectors/",
  "src/utils/runtime-react/",
  "src/utils/runtime-svelte/",
  "src/utils/svelte-selectors/",
];

const normalizePath = (path) => path.replaceAll("\\", "/");
const projectPath = (path) => normalizePath(relative(root, path));
const isAdapterPath = (path) =>
  adapterFiles.has(path) || adapterDirectories.some((directory) => path.startsWith(directory));
const isForbiddenPackage = (specifier) =>
  specifier === "react" ||
  specifier.startsWith("react/") ||
  specifier.startsWith("@preact/") ||
  specifier === "svelte" ||
  specifier.startsWith("svelte/");

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(path);
      if (!entry.isFile() || !sourceExtensions.includes(extname(entry.name))) return [];
      if (/\.(?:test|spec)\.[^.]+$/.test(entry.name) || entry.name.endsWith(".d.ts")) return [];
      return [path];
    })
  );
  return files.flat();
}

function importSpecifiers(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const specifiers = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      typeof node.source?.value === "string"
    ) {
      specifiers.push(node.source.value);
    } else if (
      node.type === "CallExpression" &&
      node.callee?.type === "Import" &&
      typeof node.arguments?.[0]?.value === "string"
    ) {
      specifiers.push(node.arguments[0].value);
    }
    for (const [key, value] of Object.entries(node)) {
      if (!["loc", "start", "end"].includes(key)) visit(value);
    }
  };
  visit(ast.program);
  return specifiers;
}

function resolveLocalImport(importer, specifier, sourceFiles) {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(importer), specifier);
  const candidates = [base, ...sourceExtensions.map((extension) => `${base}${extension}`)];
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extname(base))) {
    candidates.push(...sourceExtensions.map((extension) => base.slice(0, -extname(base).length) + extension));
  }
  candidates.push(...sourceExtensions.map((extension) => join(base, `index${extension}`)));
  return candidates.find((candidate) => sourceFiles.has(candidate));
}

function findForbiddenDependency(file, graph, seen = new Set()) {
  if (seen.has(file)) return undefined;
  const nextSeen = new Set(seen).add(file);
  for (const dependency of graph.get(file) ?? []) {
    if (isForbiddenPackage(dependency.specifier)) {
      return [...nextSeen, dependency.specifier];
    }
    if (!dependency.target) continue;
    if (isAdapterPath(projectPath(dependency.target))) {
      return [...nextSeen, dependency.target];
    }
    const transitive = findForbiddenDependency(dependency.target, graph, nextSeen);
    if (transitive) return transitive;
  }
  return undefined;
}

describe("shared runtime framework boundary", () => {
  it("has no direct or transitive React, Preact, Svelte, or adapter dependency", async () => {
    const files = await collectSourceFiles(sourceRoot);
    const sourceFiles = new Set(files);
    const graph = new Map();
    for (const file of files) {
      const source = await readFile(file, "utf8");
      graph.set(
        file,
        importSpecifiers(source).map((specifier) => ({
          specifier,
          target: resolveLocalImport(file, specifier, sourceFiles),
        }))
      );
    }

    const violations = files
      .filter((file) => !isAdapterPath(projectPath(file)))
      .map((file) => findForbiddenDependency(file, graph))
      .filter(Boolean)
      .map((chain) => chain.map((entry) => entry.startsWith(root) ? projectPath(entry) : entry));

    expect(violations).toEqual([]);
  });

  it("detects a forbidden dependency through an otherwise shared module", () => {
    const shared = join(sourceRoot, "shared.ts");
    const bridge = join(sourceRoot, "bridge.ts");
    const graph = new Map([
      [shared, [{ specifier: "./bridge", target: bridge }]],
      [bridge, [{ specifier: "react", target: undefined }]],
    ]);

    expect(findForbiddenDependency(shared, graph)).toEqual([shared, bridge, "react"]);
  });
});