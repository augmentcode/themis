import { readFile, readdir } from "node:fs/promises";
import { Linter } from "eslint";
import { parse } from "@babel/parser";
import { describe, expect, it, vi } from "vitest";
import * as architectureRootModule from "../eslint-plugins/index.mjs";
import { architectureRulePlugins } from "../eslint-plugins/plugins/index.mjs";
import { formatArchitectureMessage } from "../eslint-plugins/rule-utils.mjs";
import {
  architecturePluginRuntimeFiles,
  architecturePluginSourceFiles,
  architectureRuleDomainById,
  architectureRuleDomains,
  ReleaseValidationError,
  forbiddenArchitecturePluginDuplicateFiles,
  generatedArchitecturePluginRuntimeFiles,
  hasExportedDeclaration,
  normalizePath,
  packageBlockedImports,
  packageEntrypointFiles,
  packageImportChecks,
  packageMarkdownFiles,
  packageName,
  packageRemovedEntrypointFiles,
  packageRuntimeFiles,
  packageTypeExportChecks,
  parsePackJson,
  nativeReplacedArchitectureRuleIds,
  standaloneArchitectureRuleIds,
  validateArchitecturePluginSingleImplementation,
  validateImports,
  validatePackageMarkdownFiles,
  validatePackContents,
  validateTypeExports,
} from "./validate-release.mjs";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const { core, store, svelte, react, streaming, plugins } = architectureRootModule;
const tsParser = {
  meta: { name: "local-babel-ts-parser" },
  parseForESLint(code) {
    const ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx", "estree"], ranges: true, tokens: true, errorRecovery: true });
    ast.tokens = ast.tokens.filter((token) => Number.isInteger(token.start) && Number.isInteger(token.end)).map((token) => ({ type: token.type.label, value: token.value == null ? code.slice(token.start, token.end) : String(token.value), loc: token.loc, range: [token.start, token.end] }));
    ast.comments = (ast.comments ?? []).map((comment) => ({ ...comment, range: [comment.start, comment.end] }));
    return { ast };
  },
};
const architectureValidationLanguageOptions = {
  ...(svelte.find((entry) => entry.languageOptions)?.languageOptions ?? {}),
  parser: tsParser,
};
const pluginNamespace = "themis";
const namespacedRuleId = (ruleId) => `${pluginNamespace}/${ruleId}`;

const mergedRules = (config) => Object.assign({}, ...config.map((entry) => entry.rules ?? {}));
const ruleSeverity = (ruleConfig) => Array.isArray(ruleConfig) ? ruleConfig[0] : ruleConfig;
const ruleIdFromName = (ruleName) => ruleName.split("/").at(-1);
const selectedRuleIdsFromConfig = (config) => config.flatMap((entry) =>
  Object.entries(entry.rules ?? {})
    .filter(([, ruleConfig]) => ruleSeverity(ruleConfig) !== "off")
    .map(([ruleName]) => ruleIdFromName(ruleName))
);
const ruleConfigFor = (rules, ruleId) => Object.entries(rules).find(([ruleName]) => ruleIdFromName(ruleName) === ruleId)?.[1];
const configByRuleId = (config, ruleId) =>
  config.find((entry) => {
    const ruleConfig = ruleConfigFor(entry.rules ?? {}, ruleId);
    return ruleConfig !== undefined && ruleSeverity(ruleConfig) !== "off";
  }) ??
  config.find((entry) => ruleConfigFor(entry.rules ?? {}, ruleId) !== undefined);
const lintArchitectureRule = (ruleId, plugin, code, filename) => {
  const linter = new Linter();
  return linter.verify(
    code,
    [
      {
        files: ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx,svelte}"],
        languageOptions: architectureValidationLanguageOptions,
        plugins: { [pluginNamespace]: plugin },
        rules: { [namespacedRuleId(ruleId)]: "error" },
      },
    ],
    { filename }
  );
};

const removedPublicPaths = [
  ".",
  "./store",
  "./middleware",
  "./init",
  "./redux-dispatch-bridge",
  "./components",
  "./components/use-init-store",
  "./components/use-run-saga",
  "./components-svelte",
  "./components-svelte/index",
  "./utils/store/create-middleware",
  "./src/middleware",
  "./src/middlewares/default",
  "./src/init",
];

const eslintPluginExportPaths = [
  "./eslint-plugins",
  "./eslint-plugins/plugins",
  ...standaloneArchitectureRuleIds.map((ruleId) => `./eslint-plugins/plugins/${ruleId}`),
];

const architectureExportPaths = [...eslintPluginExportPaths];

const packEntry = (path) => ({ path });

const selectorSourceDirs = [
  "../src/utils/selector-core/",
  "../src/utils/svelte-selectors/",
  "../src/utils/streaming-selectors/",
  "../src/components-svelte/",
];

async function listSelectorSourceFiles(dirUrl, prefix) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) return listSelectorSourceFiles(new URL(`${entry.name}/`, dirUrl), path);
      if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
      return [path];
    })
  );
  return nestedFiles.flat();
}

function isBarrelOnlySelectorSource(source) {
  const executableLines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));
  return executableLines.length > 0 && executableLines.every((line) =>
    line.startsWith("import ") || line.startsWith("export *") || /^export\s+(?:type\s+)?\{/.test(line)
  );
}

const validPack = () => [
  {
    files: [
      packEntry("package/package.json"),
      ...packageEntrypointFiles.map((path) => packEntry(`package/${path}`)),
      ...packageMarkdownFiles.map((path) => packEntry(`package/${path}`)),
      ...packageRuntimeFiles.map((path) => packEntry(`package/${path}`)),
    ],
  },
];

const packWithout = (path) => [
  {
    files: validPack()[0].files.filter((file) => normalizePath(file.path) !== path),
  },
];

describe("package metadata", () => {
  it("wires package scripts for testing, validation, and npm packaging", () => {
    expect(packageJson.name).toBe("@augmentcode/themis");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.bin).toEqual({ "themis": "./scripts/cli.mjs" });
    expect(packageJson.scripts.build).toBe("vite build");
    expect(packageJson.scripts.prepack).toBe("npm run build");
    expect(packageJson.scripts.test).toBe("npx --no-install vitest run");
    expect(packageJson.scripts["validate:architecture"]).toBe("node scripts/validate-architecture.mjs");
    expect(packageJson.scripts["validate:release"]).toBe("node scripts/validate-release.mjs");
    expect(packageJson.scripts["cleanup:skills"]).toBe("node scripts/cleanup-skills.mjs");
    expect(packageJson.scripts["install:skills"]).toBe("node scripts/cli.mjs install-skills");
    expect(packageJson.scripts.postinstall).toBeUndefined();
    expect(packageJson.scripts["generate:eslint-plugins"]).toBeUndefined();
    expect(packageJson.dependencies["@tanstack/intent"]).toBeUndefined();
    expect(packageJson.devDependencies["@tanstack/intent"]).toBeUndefined();
    expect(packageJson.devDependencies["@typescript-eslint/parser"]).toBeUndefined();
    expect(packageJson.devDependencies.eslint).toBeDefined();
    expect(packageJson.scripts.preuninstall).toBeUndefined();
  });

  it("no longer declares Intent metadata but still ships docs and packaged skills", () => {
    expect(packageJson.intent).toBeUndefined();
    expect(packageJson.files).toEqual(expect.arrayContaining(["docs/", "skills/"]));
  });

  it("publishes built package, docs, skills, skill maintenance scripts, and ESLint architecture runtime", () => {
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "dist/",
        "docs/",
        "skills/",
        "scripts/",
        "eslint-plugins/",
        "!scripts/*.test.mjs",
        "!scripts/**/*.test.mjs",
        "!scripts/validate-release.mjs",
        "!eslint-plugins/*.test.mjs",
        "!eslint-plugins/**/*.test.mjs",
        "!eslint-plugins/README.md",
        "!eslint-plugins/fixtures/",
        "!eslint-plugins/**/fixtures/",
        "!skills/_artifacts",
      ])
    );
    expect(packageRuntimeFiles).toContain("scripts/cli.mjs");
    expect(packageRuntimeFiles).not.toContain("scripts/generate-eslint-plugin-runtime.mjs");
    expect(packageRuntimeFiles).not.toContain("scripts/validate-architecture.mjs");
    expect(packageRuntimeFiles).toContain("eslint-plugins/index.mjs");
    expect(packageRuntimeFiles).toContain("eslint-plugins/ast-utils.mjs");
    expect(packageRuntimeFiles.some((path) => path.includes("/rules/"))).toBe(false);
    expect(packageRuntimeFiles).toEqual(expect.arrayContaining(architecturePluginRuntimeFiles));
    expect(architecturePluginSourceFiles).toContain("eslint-plugins/core/pass-through-wrapper/plugin.mjs");
    expect(architecturePluginSourceFiles).toContain("eslint-plugins/svelte/forbidden-component-import/plugin.mjs");
    expect(generatedArchitecturePluginRuntimeFiles).toContain("eslint-plugins/generated/forbidden-component-import.mjs");
    expect(architecturePluginRuntimeFiles).toContain("eslint-plugins/core/pass-through-wrapper/plugin.mjs");
    expect(architecturePluginRuntimeFiles).toContain("eslint-plugins/svelte/forbidden-component-import/plugin.mjs");
    expect(architecturePluginRuntimeFiles).not.toContain("eslint-plugins/generated/forbidden-component-import.mjs");
    expect(architecturePluginRuntimeFiles).not.toContain("eslint-plugins/plugins/forbidden-component-import.mjs");
    expect(forbiddenArchitecturePluginDuplicateFiles).toEqual(
      expect.arrayContaining([
        "scripts/generate-eslint-plugin-runtime.mjs",
        "eslint-plugins/svelte/forbidden-component-import/plugin.ts",
        "eslint-plugins/generated/forbidden-component-import.mjs",
      ])
    );
    expect(packageRuntimeFiles).not.toContain("eslint-plugins/source-utils.mjs");
    expect(packageJson.files).toEqual(expect.arrayContaining(["!scripts/validate-architecture.mjs"]));
  });

  it("declares only the approved package entrypoint exports", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      "./package.json",
      "./components-svelte/use-init-store",
      "./components-svelte/use-run-saga",
      "./saga",
      "./react-store",
      "./svelte-store",
      "./streaming-store",
      "./types",
      "./utils/collections/collection-utils",
      "./utils/store/create-action",
      "./utils/store/create-reducer",
      "./utils/store/boolean-preference",
      "./utils/store/domain-scoped",
      "./utils/sagas/debounce-saga",
      "./utils/sagas/retry-with-timeout",
      "./utils/sagas/wrap-async-generator",
      "./utils/sagas/selector-channel-effects",
      ...architectureExportPaths,
    ].sort());
    expect(packageJson.exports["."]).toBeUndefined();
    expect(packageJson.exports["./svelte-store"]).toEqual({
      types: "./dist/svelte-store.d.ts",
      svelte: "./dist/svelte-store.js",
      import: "./dist/svelte-store.js",
      default: "./dist/svelte-store.js",
    });
    expect(packageJson.exports["./react-store"]).toEqual({
      types: "./dist/react-store.d.ts",
      svelte: "./dist/react-store.js",
      import: "./dist/react-store.js",
      default: "./dist/react-store.js",
    });
    for (const path of removedPublicPaths) {
      expect(packageJson.exports[path]).toBeUndefined();
    }
    expect(packageJson.exports["./utils"]).toBeUndefined();
    expect(packageJson.exports["./*"]).toBeUndefined();
  });

  it("exports only the approved root static config values without public helper APIs", () => {
    const allRuleIds = Object.keys(architectureRulePlugins).sort();
    const storeRootRuleIds = [...architectureRuleDomains.core, ...architectureRuleDomains.store];
    const expectedRootRuleIds = {
      core: architectureRuleDomains.core,
      store: storeRootRuleIds,
      svelte: [...storeRootRuleIds, ...architectureRuleDomains.svelte],
      react: [...storeRootRuleIds, ...architectureRuleDomains.react],
      streaming: storeRootRuleIds,
    };
    const expectedRootRuleCounts = { core: 4, store: 41, svelte: 44, react: 45, streaming: 41 };

    expect(Object.keys(architectureRootModule).sort()).toEqual(["core", "plugins", "react", "store", "streaming", "svelte"]);
    expect(architectureRootModule.full).toBeUndefined();
    expect(architectureRootModule.recommended).toBeUndefined();
    expect(Array.isArray(core)).toBe(true);
    expect(Array.isArray(store)).toBe(true);
    expect(Array.isArray(svelte)).toBe(true);
    expect(Array.isArray(react)).toBe(true);
    expect(Array.isArray(streaming)).toBe(true);
    expect(Object.keys(plugins).sort()).toEqual(allRuleIds);
    expect(architectureRootModule.architectureConfig).toBeUndefined();
    expect(architectureRootModule.architecturePlugin).toBeUndefined();
    for (const [name, ruleIds] of Object.entries(expectedRootRuleIds)) {
      expect(selectedRuleIdsFromConfig(architectureRootModule[name]).sort(), `${name} selected rules`).toEqual([...ruleIds].sort());
      expect(selectedRuleIdsFromConfig(architectureRootModule[name]), `${name} selected rule count`).toHaveLength(expectedRootRuleCounts[name]);
    }

    for (const [name, config] of Object.entries({ core, store, svelte, react, streaming })) {
      expect(Object.keys(config[0].plugins)).toEqual([pluginNamespace]);
      expect(Object.keys(config[0].plugins[pluginNamespace].rules).sort()).toEqual(allRuleIds);
      expect(Object.keys(config[0].rules).sort()).toEqual(allRuleIds.map(namespacedRuleId).sort());
      for (const ruleId of allRuleIds) {
        expect(ruleSeverity(config[0].rules[namespacedRuleId(ruleId)]), `${name} base ${ruleId}`).toBe("off");
      }
      for (const entry of config.slice(1)) {
        expect(entry.plugins).toBeUndefined();
        expect(Object.keys(entry.rules)).toHaveLength(1);
        const [[ruleName, ruleConfig]] = Object.entries(entry.rules);
        expect(ruleName.startsWith(`${pluginNamespace}/`)).toBe(true);
        expect(ruleSeverity(ruleConfig)).toBe("warn");
      }
    }

    for (const [ruleId, config] of Object.entries(plugins)) {
      expect(Object.keys(config.plugins)).toEqual([pluginNamespace]);
      expect(Object.keys(config.plugins[pluginNamespace].rules).sort()).toEqual(allRuleIds);
      expect(config.rules).toEqual({ [namespacedRuleId(ruleId)]: "warn" });
    }

    for (const [name, ruleIds] of Object.entries(expectedRootRuleIds)) {
      const rootRules = mergedRules(architectureRootModule[name]);
      for (const ruleId of allRuleIds.filter((candidate) => !ruleIds.includes(candidate))) {
        expect(ruleSeverity(ruleConfigFor(rootRules, ruleId)), `${name} excluded ${ruleId}`).toBe("off");
      }
    }
  });

  it("keeps whole-file native replacement configs focused on file-level architecture rules", () => {
    const removedMiddlewareRules = Object.keys(
      configByRuleId(svelte, "removed-middleware-source").rules
    );
    const sharedStoreRules = Object.keys(
      configByRuleId(svelte, "shared-svelte-store-boundary").rules
    );

    expect(removedMiddlewareRules.map(ruleIdFromName)).toEqual(["removed-middleware-source"]);
    expect(removedMiddlewareRules.map(ruleIdFromName)).not.toContain("selector-file-name");
    expect(sharedStoreRules.map(ruleIdFromName)).toEqual(["shared-svelte-store-boundary"]);
    expect(sharedStoreRules.map(ruleIdFromName)).not.toContain("selector-file-name");
  });

  it("maps utility exports to concrete leaf files without directory barrels", () => {
    for (const [specifier, target] of Object.entries(packageJson.exports)) {
      if (specifier === "./package.json") continue;
      expect(specifier.endsWith("/*")).toBe(false);
      expect(target.import).not.toMatch(/(?:^|\/)index\.js$/);
      if (target.types) expect(target.types).not.toMatch(/(?:^|\/)index\.d\.ts$/);
    }
  });

  it("keeps selector and Svelte component helper source paths direct and free of barrel-only files", async () => {
    const files = (
      await Promise.all(
        selectorSourceDirs.map((dir) =>
          listSelectorSourceFiles(new URL(dir, import.meta.url), dir.replace(/^\.\.\//, "").replace(/\/$/, ""))
        )
      )
    ).flat();

    expect(files).not.toEqual(expect.arrayContaining([
      "src/utils/selector-core/index.ts",
      "src/utils/svelte-selectors/index.ts",
      "src/utils/streaming-selectors/index.ts",
      "src/components-svelte/index.ts",
    ]));

    const barrelOnlyFiles = [];
    for (const file of files.filter((path) => !path.endsWith(".test.ts"))) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
      if (isBarrelOnlySelectorSource(source)) barrelOnlyFiles.push(file);
    }

    expect(barrelOnlyFiles).toEqual([]);
  });

  it("self-references approved subpackage and manifest exports only", async () => {
    const [
      svelteStore,
      streamingStore,
      reactStore,
      saga,
      types,
      manifest,
      createActionModule,
      createReducerModule,
      collectionModule,
      booleanPreferenceModule,
      domainScopedModule,
      useInitStoreModule,
      useRunSagaModule,
      selectorChannelModule,
      architectureModule,
      architecturePluginsModule,
      passThroughWrapperModule,
      duplicateActionTypeModule,
    ] = await Promise.all([
      import(`${packageJson.name}/svelte-store`),
      import(`${packageJson.name}/streaming-store`),
      import(`${packageJson.name}/react-store`),
      import(`${packageJson.name}/saga`),
      import(`${packageJson.name}/types`),
      import(`${packageJson.name}/package.json`, { with: { type: "json" } }),
      import(`${packageJson.name}/utils/store/create-action`),
      import(`${packageJson.name}/utils/store/create-reducer`),
      import(`${packageJson.name}/utils/collections/collection-utils`),
      import(`${packageJson.name}/utils/store/boolean-preference`),
      import(`${packageJson.name}/utils/store/domain-scoped`),
      import(`${packageJson.name}/components-svelte/use-init-store`),
      import(`${packageJson.name}/components-svelte/use-run-saga`),
      import(`${packageJson.name}/utils/sagas/selector-channel-effects`),
      import(`${packageJson.name}/eslint-plugins`),
      import(`${packageJson.name}/eslint-plugins/plugins`),
      import(`${packageJson.name}/eslint-plugins/plugins/pass-through-wrapper`),
      import(`${packageJson.name}/eslint-plugins/plugins/duplicate-action-type`),
    ]);

    await expect(import(packageJson.name)).rejects.toThrow();
    expect(typeof svelteStore.Store).toBe("function");
    expect(typeof svelteStore.getDispatch).toBe("function");
    expect(svelteStore.SvelteStore).toBeUndefined();
    expect(svelteStore.StreamingStore).toBeUndefined();
    expect(typeof streamingStore.StreamingStore).toBe("function");
    expect(streamingStore.Store).toBeUndefined();
    expect(streamingStore.SvelteStore).toBeUndefined();
    expect(typeof reactStore.ReactStore).toBe("function");
    expect(reactStore.Store).toBeUndefined();
    expect(reactStore.StreamingStore).toBeUndefined();
    expect(reactStore.createSelector).toBeUndefined();
    expect(svelteStore.createAction).toBeUndefined();
    expect(svelteStore.createAsyncAction).toBeUndefined();
    expect(svelteStore.createReducer).toBeUndefined();
    expect(svelteStore.createDomainScopedHelpers).toBeUndefined();
    expect(svelteStore.createBooleanPreference).toBeUndefined();
    expect(svelteStore.createCollection).toBeUndefined();
    expect(svelteStore.addItem).toBeUndefined();
    expect(svelteStore.getItems).toBeUndefined();
    expect(svelteStore.useInitStore).toBeUndefined();
    expect(svelteStore.getReduxStore).toBeUndefined();
    expect(svelteStore.createMiddleware).toBeUndefined();
    expect(svelteStore.createStoreContext).toBeUndefined();
    expect(svelteStore.createReduxStoreContext).toBeUndefined();
    expect(svelteStore.createCachedSelector).toBeUndefined();
    expect(svelteStore.lockUpdates).toBeUndefined();
    expect(svelteStore.unlockUpdates).toBeUndefined();
    expect(svelteStore.init).toBeUndefined();
    expect(svelteStore.createSelector).toBeUndefined();
    expect(typeof saga.waitFor).toBe("function");
    expect(saga.useRunSaga).toBeUndefined();
    expect(saga.runSagaHelper).toBeUndefined();
    expect(saga.startSaga).toBeUndefined();
    expect(saga.getLocalStorageItem).toBeUndefined();
    expect(saga.setLocalStorageItem).toBeUndefined();
    expect(saga.getLocalStorageJSON).toBeUndefined();
    expect(saga.setLocalStorageJSON).toBeUndefined();
    expect(types).toBeDefined();
    expect(manifest.default.name).toBe(packageJson.name);
    expect(typeof createActionModule.createAction).toBe("function");
    expect(typeof createReducerModule.createReducer).toBe("function");
    expect(typeof collectionModule.createCollection).toBe("function");
    expect(typeof booleanPreferenceModule.createBooleanPreference).toBe("function");
    expect(typeof domainScopedModule.createDomainScopedHelpers).toBe("function");
    expect(typeof useInitStoreModule.useInitStore).toBe("function");
    expect(typeof useRunSagaModule.useRunSaga).toBe("function");
    expect(typeof selectorChannelModule.takeEveryFromSelector).toBe("function");
    expect(Object.keys(architectureModule).sort()).toEqual(["core", "plugins", "react", "store", "streaming", "svelte"]);
    expect(architectureModule.full).toBeUndefined();
    expect(architectureModule.recommended).toBeUndefined();
    expect(Array.isArray(architectureModule.core)).toBe(true);
    expect(Array.isArray(architectureModule.store)).toBe(true);
    expect(Array.isArray(architectureModule.svelte)).toBe(true);
    expect(Array.isArray(architectureModule.react)).toBe(true);
    expect(Array.isArray(architectureModule.streaming)).toBe(true);
    expect(architectureModule.plugins).toBe(plugins);
    expect(architectureModule.core).toBe(core);
    expect(architectureModule.store).toBe(store);
    expect(architectureModule.svelte).toBe(svelte);
    expect(architectureModule.react).toBe(react);
    expect(architectureModule.streaming).toBe(streaming);
    const architectureLanguageOptions = architectureValidationLanguageOptions;
    const rootImportCheck = packageImportChecks.find(({ specifier }) => specifier === `${packageJson.name}/eslint-plugins`);
    expect(rootImportCheck.required).toEqual(["core", "store", "plugins", "svelte", "react", "streaming"]);
    expect(rootImportCheck.blocked).toEqual(expect.arrayContaining([
      "full",
      "recommended",
      "architectureConfig",
      "architecturePlugin",
      "architectureRules",
      "architectureRulePlugins",
      "architectureLanguageOptions",
      "createArchitectureConfig",
      "createArchitectureFlatConfig",
      "createNativeArchitectureReplacementConfigs",
      "createArchitectureRuleConfig",
      "architectureEslintCompatibilityPlan",
    ]));
    expect(architectureModule.architectureConfig).toBeUndefined();
    expect(architectureModule.architecturePlugin).toBeUndefined();
    expect(architectureModule.createArchitectureRuleConfig).toBeUndefined();
    expect(architectureModule.createArchitectureConfig).toBeUndefined();
    expect(architectureModule.createNativeArchitectureReplacementConfigs).toBeUndefined();
    expect(architecturePluginsModule.architectureRulePlugins["pass-through-wrapper"]).toBe(passThroughWrapperModule.plugin);
    expect(architecturePluginsModule.architectureRulePlugins["duplicate-action-type"]).toBe(duplicateActionTypeModule.plugin);
    expect(architecturePluginsModule.createArchitectureRuleConfig).toBeUndefined();
    expect(architecturePluginsModule.ruleConfigForPlugins).toBeUndefined();
    expect(passThroughWrapperModule.ruleId).toBe("pass-through-wrapper");
    expect(duplicateActionTypeModule.ruleId).toBe("duplicate-action-type");
    expect(passThroughWrapperModule.plugin.rules["pass-through-wrapper"]).toBe(passThroughWrapperModule.rule);
    expect(duplicateActionTypeModule.plugin.rules["duplicate-action-type"]).toBe(duplicateActionTypeModule.rule);

    const svelteRootRules = mergedRules(architectureModule.svelte);
    const reactRootRules = mergedRules(architectureModule.react);
    for (const ruleId of Object.keys(architectureRulePlugins)) {
      const severities = [svelteRootRules, reactRootRules].map((rules) => ruleSeverity(ruleConfigFor(rules, ruleId)));
      expect(severities, ruleId).toContain("warn");
    }
    for (const ruleId of nativeReplacedArchitectureRuleIds) {
      expect(ruleConfigFor(svelteRootRules, ruleId)).toBeUndefined();
      expect(ruleConfigFor(reactRootRules, ruleId)).toBeUndefined();
    }
    expect(Object.keys(architectureModule.svelte[0].plugins)).toEqual([pluginNamespace]);
    for (const [ruleId, ruleConfig] of Object.entries(architectureModule.svelte[0].rules)) {
      expect(ruleId.startsWith(`${pluginNamespace}/`)).toBe(true);
      expect(ruleSeverity(ruleConfig), `svelte base ${ruleId}`).toBe("off");
    }
    for (const config of architectureModule.svelte.slice(1)) {
      expect(config.plugins).toBeUndefined();
      for (const [ruleId, ruleConfig] of Object.entries(config.rules ?? {})) {
        expect(ruleSeverity(ruleConfig), `${config.name} ${ruleId}`).toBe("warn");
      }
    }

    const linter = new Linter();
    for (const config of [architectureModule.svelte, architectureModule.react, [...architectureModule.svelte, ...architectureModule.react]]) {
      expect(() => linter.verify("const value = 1;", config, { filename: "src/todos.js" })).not.toThrow();
    }
    const oneRuleMessages = linter.verify(
      'export { newFeature } from "./new-feature";',
      [
        {
          files: ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx,svelte}"],
          languageOptions: architectureLanguageOptions,
          plugins: { "themis": passThroughWrapperModule.plugin },
          rules: { "themis/pass-through-wrapper": "error" },
        },
      ],
      { filename: "src/legacy-wrapper.ts" }
    );
    expect(oneRuleMessages.map(({ ruleId }) => ruleId)).toEqual(["themis/pass-through-wrapper"]);

    const selectedPlugin = {
      rules: {
        ...duplicateActionTypeModule.plugin.rules,
        ...architecturePluginsModule.directSelectorCallModePlugin.rules,
      },
    };
    const subsetMessages = linter.verify(
      'import { selectTodos } from "../todos/todos-selectors";\nfunction handleClick() { selectTodos(); }\nconst add = createAction("todos/add");\nconst addAgain = createAction("todos/add");',
      [
        {
          files: ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx,svelte}"],
          languageOptions: architectureLanguageOptions,
          plugins: { "themis": selectedPlugin },
          rules: {
            "themis/duplicate-action-type": "error",
            "themis/direct-selector-call-mode": "error",
          },
        },
      ],
      { filename: "src/ui/todos-view.ts" }
    );
    expect(subsetMessages.map(({ ruleId }) => ruleId).sort()).toEqual([
      "themis/direct-selector-call-mode",
      "themis/duplicate-action-type",
    ]);
  });

  it("flags pass-through saga generator wrappers without flagging meaningful saga logic", () => {
    const messages = lintArchitectureRule(
      "pass-through-wrapper",
      architectureRulePlugins["pass-through-wrapper"],
      `
        function* getWsState(wsId: string): SagaGenerator<FileExplorerWorkspaceState> {
          return yield* selectFileExplorerState.effect(wsId);
        }
        export function* readWsState(wsId: string): SagaGenerator<FileExplorerWorkspaceState> {
          yield* selectFileExplorerState.effect(wsId);
        }
        export function* readReady(): SagaGenerator<boolean> {
          yield* selectReady.effect();
        }
        export const readAlias = function* (wsId: string, ...keys: string[]) {
          return yield* loadWorkspace(wsId, ...keys);
        };

        function* withAssignment(wsId: string) {
          const state = yield* selectFileExplorerState.effect(wsId);
          return state;
        }
        function* withBranch(wsId: string) {
          if (wsId) return yield* selectFileExplorerState.effect(wsId);
          return undefined;
        }
        function* withCleanup(wsId: string) {
          try { return yield* selectFileExplorerState.effect(wsId); }
          finally { cleanup(wsId); }
        }
        function* withLoop(wsId: string) {
          while (wsId) yield* pollWorkspace(wsId);
        }
        function* multipleEffects(wsId: string) {
          yield* firstWorkspaceEffect(wsId);
          return yield* secondWorkspaceEffect(wsId);
        }
        function* transformsArgument(wsId: string) {
          return yield* selectFileExplorerState.effect(wsId.trim());
        }
        function* selfRecursive(wsId: string) {
          return yield* selfRecursive(wsId);
        }
      `,
      "src/sagas/file-explorer-saga.ts"
    );

    expect(messages).toHaveLength(4);
    expect(messages.map(({ ruleId }) => ruleId)).toEqual([
      namespacedRuleId("pass-through-wrapper"),
      namespacedRuleId("pass-through-wrapper"),
      namespacedRuleId("pass-through-wrapper"),
      namespacedRuleId("pass-through-wrapper"),
    ]);
    expect(messages[0].message).toContain("inline the selector/effect call");
    expect(messages[0].message).toContain("rule-specific ESLint disable reason");
  });

  it("filters direct selector calls to named imports from selector modules", () => {
    const messages = lintArchitectureRule(
      "direct-selector-call-mode",
      architectureRulePlugins["direct-selector-call-mode"],
      `
        import { selectTodos, selectDone as readDone } from "../todos/todos-selectors";
        import { selectArchived } from "../../slices/todos/todos-selectors.ts";
        import { selectFixture } from "../test-helpers";
        import { selectUtility } from "../utils/svelte-selectors/create-selector";
        import { selectCached } from "../utils/selector-core/create-cached-selector";
        import { selectChannel } from "../utils/sagas/selector-channel-effects";

        function selectLocal() {}
        function handleClick() {
          selectTodos();
          readDone();
          selectArchived();
          selectFixture();
          selectUtility();
          selectCached();
          selectChannel();
          selectLocal();
        }
      `,
      "src/ui/todos-view.ts"
    );

    expect(messages.map(({ ruleId }) => ruleId)).toEqual([
      namespacedRuleId("direct-selector-call-mode"),
      namespacedRuleId("direct-selector-call-mode"),
      namespacedRuleId("direct-selector-call-mode"),
    ]);
  });

  it("leaves React component direct selector signals to the React selector rule", () => {
    const messages = lintArchitectureRule(
      "direct-selector-call-mode",
      architectureRulePlugins["direct-selector-call-mode"],
      `
        import { selectTodos } from "../todos/todos-selectors";

        export function TodosPanel() {
          const todos = selectTodos();
          return <p>{todos.value.length}</p>;
        }
      `,
      "src/components/TodosPanel.tsx"
    );

    expect(messages).toEqual([]);
  });

  it("validates React selector signals without rejecting direct selector calls", () => {
    const validMessages = lintArchitectureRule(
      "react-prefer-direct-selector",
      architectureRulePlugins["react-prefer-direct-selector"],
      `
        import { selectTodoById, selectTodos } from "../todos/todos-selectors";

        function TodoSummary({ todosSignal }) {
          return <span>{todosSignal.value.length}</span>;
        }

        export function TodosPanel() {
          const todos = selectTodos();
          const first = selectTodoById("first");
          return <TodoSummary todosSignal={todos}>{first.value?.label}</TodoSummary>;
        }
      `,
      "src/components/TodosPanel.tsx"
    );
    const invalidMessages = lintArchitectureRule(
      "react-prefer-direct-selector",
      architectureRulePlugins["react-prefer-direct-selector"],
      `
        import { selectTodoById, selectTodos } from "../todos/todos-selectors";

        export function TodosPanel() {
          const fallbackTodos = selectTodos.useValue();
          const todos = selectTodos();
          const first = selectTodoById("first");
          const { length } = selectTodos();
          return <p>{fallbackTodos.length} {todos.length} {first?.label} {length}</p>;
        }
      `,
      "src/components/TodosPanel.tsx"
    );

    expect(validMessages).toEqual([]);
    expect(invalidMessages.map(({ ruleId }) => ruleId)).toEqual([
      namespacedRuleId("react-prefer-direct-selector"),
      namespacedRuleId("react-prefer-direct-selector"),
      namespacedRuleId("react-prefer-direct-selector"),
      namespacedRuleId("react-prefer-direct-selector"),
    ]);
    expect(invalidMessages.map(({ message }) => message).join("\n")).toContain("ReadonlySignal");
  });

  it("filters test selector readable calls to named imports from selector modules", () => {
    const messages = lintArchitectureRule(
      "test-selector-select",
      architectureRulePlugins["test-selector-select"],
      `
        import { selectTodos, selectDone as readDone } from "../todos/todos-selectors";
        import { selectArchived } from "../../slices/todos/todos-selectors.ts";
        import { selectFixture } from "../test-helpers";
        import { selectUtility } from "../utils/svelte-selectors/create-selector";
        import { selectCached } from "../utils/selector-core/create-cached-selector";
        import { selectChannel } from "../utils/sagas/selector-channel-effects";

        function selectLocal(state) { return state.todos; }
        test("todos", () => {
          const state = {};
          selectTodos(state);
          readDone(withTodosState());
          selectArchived(state);
          selectFixture(state);
          selectUtility(state);
          selectCached(state);
          selectChannel(state);
          selectLocal(state);
        });
      `,
      "src/todos.test.ts"
    );

    expect(messages.map(({ ruleId }) => ruleId)).toEqual([
      namespacedRuleId("test-selector-select"),
      namespacedRuleId("test-selector-select"),
      namespacedRuleId("test-selector-select"),
    ]);
  });

  it("flags saga-local selector declarations while ignoring imported selectors", () => {
    const invalidMessages = lintArchitectureRule(
      "saga-local-selector",
      architectureRulePlugins["saga-local-selector"],
      `
        import { createSelector } from "../utils/selector-core/create-cached-selector";

        const selectReady = (state) => state.todos.ready;
        function selectDone(state) { return state.todos.done; }
        export const selectCount = createSelector(
          [(state) => state.todos.items],
          (items) => items.length
        );
        const aggregatedSelector = createSelector([(state) => state.todos], (todos) => todos);

        export function* todosSaga() {
          return selectReady;
        }
      `,
      "src/todos/todos-saga.ts"
    );

    expect(invalidMessages.map(({ ruleId }) => ruleId)).toEqual([
      namespacedRuleId("saga-local-selector"),
      namespacedRuleId("saga-local-selector"),
      namespacedRuleId("saga-local-selector"),
      namespacedRuleId("saga-local-selector"),
    ]);
    expect(invalidMessages[0].message).toContain("[slice]-selectors");

    const validMessages = lintArchitectureRule(
      "saga-local-selector",
      architectureRulePlugins["saga-local-selector"],
      `
        import { selectReady, selectDone } from "../todos/todos-selectors";

        export function* todosSaga() {
          const ready = yield* selectReady.effect();
          const done = yield* selectDone.effect();
          return { ready, done };
        }
      `,
      "src/todos/todos-saga.ts"
    );

    expect(validMessages).toEqual([]);

    const nonSagaMessages = lintArchitectureRule(
      "saga-local-selector",
      architectureRulePlugins["saga-local-selector"],
      `
        const selectReady = (state) => state.todos.ready;
        export function selectDone(state) { return state.todos.done; }
      `,
      "src/todos/todos-selectors.ts"
    );

    expect(nonSagaMessages).toEqual([]);
  });

  it("flags wildcard saga takes while allowing concrete actions, channels, and pattern arrays", () => {
    const invalidMessages = lintArchitectureRule(
      "no-wildcard-saga-take",
      architectureRulePlugins["no-wildcard-saga-take"],
      `
        import { take, takeEvery, takeLatest, takeLeading } from "typed-redux-saga";

        function* anyWorker() {}

        export function* todosSaga() {
          yield* take("*");
          yield* takeEvery("*", anyWorker);
          yield* takeLatest(["*"], anyWorker);
          yield* takeLeading(\`*\`, anyWorker);
        }
      `,
      "src/todos/todos-saga.ts"
    );

    expect(invalidMessages.map(({ ruleId }) => ruleId)).toEqual([
      namespacedRuleId("no-wildcard-saga-take"),
      namespacedRuleId("no-wildcard-saga-take"),
      namespacedRuleId("no-wildcard-saga-take"),
      namespacedRuleId("no-wildcard-saga-take"),
    ]);
    expect(invalidMessages[0].message).toContain("should not subscribe to '*'");

    const validMessages = lintArchitectureRule(
      "no-wildcard-saga-take",
      architectureRulePlugins["no-wildcard-saga-take"],
      `
        import { take, takeEvery } from "typed-redux-saga";
        import { loadTodos, refreshTodos } from "./todos-slice";

        function* loadTodosWorker() {}

        export function* todosSaga(channel) {
          yield* take(channel);
          yield* take(loadTodos);
          yield* takeEvery([loadTodos, refreshTodos], loadTodosWorker);
        }
      `,
      "src/todos/todos-saga.ts"
    );

    expect(validMessages).toEqual([]);

    const nonSagaMessages = lintArchitectureRule(
      "no-wildcard-saga-take",
      architectureRulePlugins["no-wildcard-saga-take"],
      `
        function take(pattern: string) { return pattern; }
        take("*");
      `,
      "src/todos/todos-helpers.ts"
    );

    expect(nonSagaMessages).toEqual([]);
  });

  it("flags extra selector caching wrappers while allowing Store selector composition and options", () => {
    const invalidMessages = lintArchitectureRule(
      "no-extra-selector-caching",
      architectureRulePlugins["no-extra-selector-caching"],
      `
        import { memoize, debounce, throttle } from "lodash";
        import { useMemo } from "react";
        import { derived, readable } from "svelte/store";
        import { selectReady, selectTodoById, selectTodos } from "../todos/todos-selectors";

        export const selectLegacyTodos = memoize((state) => state.todos.items);
        export const selectWrappedTodos = memoize(store.createSelector((state) => state.todos.items));
        export const selectLodashMemoizedTodos = _.memoize(selectTodos);

        export function TodoView({ id }) {
          const todos = useMemo(() => selectTodos(), []);
          const debouncedTodo = debounce(() => selectTodoById(id), 100);
          const throttledReady = throttle(() => selectReady.select(store.state), 100);
          const derivedTodos = derived(selectTodos(), ($todos) => $todos.length);
          const readableTodos = readable([], (set) => selectTodos().subscribe(set));
          return { todos, debouncedTodo, throttledReady, derivedTodos, readableTodos };
        }
      `,
      "src/ui/todos-view.ts"
    );

    expect(invalidMessages.map(({ ruleId }) => ruleId)).toEqual([
      namespacedRuleId("no-extra-selector-caching"),
      namespacedRuleId("no-extra-selector-caching"),
      namespacedRuleId("no-extra-selector-caching"),
      namespacedRuleId("no-extra-selector-caching"),
      namespacedRuleId("no-extra-selector-caching"),
      namespacedRuleId("no-extra-selector-caching"),
      namespacedRuleId("no-extra-selector-caching"),
      namespacedRuleId("no-extra-selector-caching"),
    ]);
    expect(invalidMessages[0].message).toContain("Store-created selectors already provide");

    const validMessages = lintArchitectureRule(
      "no-extra-selector-caching",
      architectureRulePlugins["no-extra-selector-caching"],
      `
        import { derived } from "svelte/store";
        import { Store } from "@augmentcode/themis/svelte-store";
        import { selectTodos } from "../todos/todos-selectors";

        export const store = new Store({ todos: todosReducer }, undefined, { throttledSelectorFrequency: 120 });

        export const selectVisibleTodos = store.createSelector((state) => {
          return selectTodos.select(state).filter((todo) => todo.visible);
        });

        const todosReadable = selectTodos();
        const todos = selectTodos.select(store.state);
        const derivedOther = derived(otherReadable, ($other) => $other.length);
      `,
      "src/todos/todos-selectors.ts"
    );

    expect(validMessages).toEqual([]);
    expect(selectedRuleIdsFromConfig(store)).toContain("no-extra-selector-caching");
    expect(selectedRuleIdsFromConfig(svelte)).toContain("no-extra-selector-caching");
    expect(selectedRuleIdsFromConfig(react)).toContain("no-extra-selector-caching");
    expect(selectedRuleIdsFromConfig(streaming)).toContain("no-extra-selector-caching");
    expect(architectureRulePlugins["no-extra-selector-caching"].rules["no-extra-selector-caching"].meta.architecture).toMatchObject({
      ruleId: "no-extra-selector-caching",
      summary: "Store-created selector is wrapped in redundant caching or optimization.",
    });
  });

  it("flags unstable selector arguments while allowing primitive and stable references", () => {
    const invalidMessages = lintArchitectureRule(
      "selector-argument-stability",
      architectureRulePlugins["selector-argument-stability"],
      `
        import { waitFor, takeEveryFromSelector } from "@augmentcode/themis/saga";
        import { selectTodoById, selectTodosByFilter } from "../todos/todos-selectors";

        export const selectTodoByObject = store.createSelector((state, { id }) => state.todos.map[id]);
        export const selectTodoByTuple = store.createSelector((state, [id]) => state.todos.map[id]);
        export const selectLocalTodo = store.createSelector((state, id) => state.todos.map[id]);

        function* todoWorker() {}

        export function useUnstableSelectorArgs(state, todoId, filter, source) {
          selectTodoById({ id: todoId });
          selectTodoById([todoId]);
          selectTodoById(() => todoId);
          selectTodoById(class TodoKey {});
          selectTodoById(new TodoKey(todoId));
          selectTodoById(...[{ id: todoId }]);
          selectTodosByFilter.select(state, { filter });
          selectTodosByFilter.effect({ filter });
          selectTodosByFilter.useValue({ filter });
          selectTodosByFilter.withStore(source)({ filter });
          selectLocalTodo({ id: todoId });
        }

        export function* watchUnstableSelectorArgs(filter) {
          yield* takeEveryFromSelector(selectTodosByFilter, [{ filter }], todoWorker);
          yield* waitFor(selectTodosByFilter, [{ filter }], (todos) => todos.length > 0, 5000);
        }
      `,
      "src/todos/todos-selectors.ts"
    );

    expect(invalidMessages.map(({ ruleId }) => ruleId)).toEqual(Array.from({ length: 15 }, () => namespacedRuleId("selector-argument-stability")));
    expect(invalidMessages.map(({ message }) => message).join("\n")).toContain("primitive/scalar");

    const validMessages = lintArchitectureRule(
      "selector-argument-stability",
      architectureRulePlugins["selector-argument-stability"],
      `
        import { waitFor, takeEveryFromSelector } from "@augmentcode/themis/saga";
        import { selectTodoById, selectTodosByFilter } from "../todos/todos-selectors";

        const stableFilter = { status: "open" };
        const stableArgs = ["first"];
        export const selectLocalTodo = store.createSelector((state, todoId) => state.todos.map[todoId]);

        function* todoWorker() {}

        export function useStableSelectorArgs(state, todoId, source, signalArg, readableArg, observableArg) {
          selectTodoById(todoId);
          selectTodoById("first");
          selectTodoById(stableFilter);
          selectTodoById(source.currentFilter);
          selectTodoById(...stableArgs);
          selectTodosByFilter.select(state, todoId, true);
          selectTodosByFilter.effect(todoId, signalArg);
          selectTodosByFilter.useValue(todoId, readableArg);
          selectTodosByFilter.withStore(source)(todoId, observableArg);
          selectLocalTodo(todoId);
        }

        export function* watchStableSelectorArgs(todoId) {
          yield* takeEveryFromSelector(selectTodosByFilter, [todoId], todoWorker);
          yield* waitFor(selectTodosByFilter, [todoId], (todos) => todos.length > 0, 5000);
        }
      `,
      "src/todos/todos-selectors.ts"
    );

    expect(validMessages).toEqual([]);
    expect(selectedRuleIdsFromConfig(store)).toContain("selector-argument-stability");
    expect(selectedRuleIdsFromConfig(svelte)).toContain("selector-argument-stability");
    expect(selectedRuleIdsFromConfig(react)).toContain("selector-argument-stability");
    expect(selectedRuleIdsFromConfig(streaming)).toContain("selector-argument-stability");
  });

  it("keeps custom ESLint rule messages concise while preserving detailed metadata", () => {
    const rule = architectureRulePlugins["test-selector-select"].rules["test-selector-select"];
    const messages = lintArchitectureRule(
      "test-selector-select",
      architectureRulePlugins["test-selector-select"],
      `
        import { selectTodos } from "../todos/todos-selectors";

        test("todos", () => {
          const state = {};
          selectTodos(state);
        });
      `,
      "src/todos.test.ts"
    );

    expect(formatArchitectureMessage({ ruleId: "architecture/test-selector-select", summary: "Line one\nline two", why: "why", fix: "fix" })).toBe("Line one line two");
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toBe("Selector test must call selectTodos.select(state, ...args) instead of selectTodos(state, ...args).");
    expect(messages[0].message).not.toMatch(/[\r\n]/);
    expect(messages[0].message).not.toContain("Why:");
    expect(messages[0].message).not.toContain("How to fix:");
    expect(rule.meta.architecture).toEqual({
      ruleId: "test-selector-select",
      summary: "Selector test called the readable selector form with state.",
      why: "The bare `selectFoo(state)` form creates a Svelte readable and needs component context; tests that pass mock state should exercise the pure selector contract.",
      fix: "Call `selectFoo.select(state, ...args)` in tests instead of `selectFoo(state, ...args)`.",
    });
  });

  it("exposes all architecture rules as standalone eslint-plugins exports", () => {
    const activeStandaloneRuleIds = [...standaloneArchitectureRuleIds].sort();
    expect(Object.keys(architectureRulePlugins).sort()).toEqual(activeStandaloneRuleIds);
    expect(nativeReplacedArchitectureRuleIds).toEqual([]);
    expect(packageJson.exports["./eslint-plugins"]).toBeDefined();
    expect(packageJson.exports["./eslint-plugins/plugins"]).toBeDefined();
    expect(packageJson.exports["./eslint-architecture"]).toBeUndefined();
    expect(packageJson.exports["./eslint-architecture/plugins"]).toBeUndefined();
    for (const ruleId of activeStandaloneRuleIds) {
      expect(packageJson.exports[`./eslint-plugins/plugins/${ruleId}`]).toBeDefined();
      expect(packageJson.exports[`./eslint-plugins/plugins/${ruleId}`].import).toBe(
        `./eslint-plugins/${architectureRuleDomainById[ruleId]}/${ruleId}/plugin.mjs`
      );
      expect(packageJson.exports[`./eslint-architecture/plugins/${ruleId}`]).toBeUndefined();
    }
    for (const ruleId of nativeReplacedArchitectureRuleIds) {
      expect(packageJson.exports[`./eslint-plugins/plugins/${ruleId}`]).toBeUndefined();
      expect(packageJson.exports[`./eslint-architecture/plugins/${ruleId}`]).toBeUndefined();
    }
  });

  it("keeps plugin.mjs as the only per-rule implementation and rejects generated runtime copies", async () => {
    const entries = await readdir(new URL("../eslint-plugins/", import.meta.url), { withFileTypes: true });
    expect(entries.filter((entry) => entry.isDirectory() && standaloneArchitectureRuleIds.includes(entry.name))).toEqual([]);

    const activeRuleDirs = [];
    for (const [domain, ruleIds] of Object.entries(architectureRuleDomains)) {
      if (ruleIds.length === 0) continue;
      const domainEntries = await readdir(new URL(`../eslint-plugins/${domain}/`, import.meta.url), { withFileTypes: true });
      activeRuleDirs.push(
        ...domainEntries.filter((entry) => entry.isDirectory() && ruleIds.includes(entry.name)).map((entry) => entry.name)
      );
      expect(domainEntries.filter((entry) => entry.isDirectory() && nativeReplacedArchitectureRuleIds.includes(entry.name))).toEqual([]);
    }

    expect(activeRuleDirs.sort()).toEqual([...standaloneArchitectureRuleIds].sort());

    for (const ruleId of standaloneArchitectureRuleIds) {
      const domain = architectureRuleDomainById[ruleId];
      const sourcePath = new URL(`../eslint-plugins/${domain}/${ruleId}/plugin.mjs`, import.meta.url);
      const duplicateSourcePath = new URL(`../eslint-plugins/${domain}/${ruleId}/plugin.ts`, import.meta.url);
      const generatedPath = new URL(`../eslint-plugins/generated/${ruleId}.mjs`, import.meta.url);
      const source = await readFile(sourcePath, "utf8");

      expect(source).toContain(`export const ruleId = "${ruleId}"`);
      await expect(readFile(duplicateSourcePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(generatedPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(architecturePluginRuntimeFiles).toContain(`eslint-plugins/${domain}/${ruleId}/plugin.mjs`);
      expect(architecturePluginRuntimeFiles).not.toContain(`eslint-plugins/${domain}/${ruleId}/plugin.ts`);
      expect(architecturePluginRuntimeFiles).not.toContain(`eslint-plugins/generated/${ruleId}.mjs`);
    }
  });

  const domainDirectoryEntries = (path) =>
    path === "eslint-plugins"
      ? Object.keys(architectureRuleDomains).map((name) => ({ name, isDirectory: () => true }))
      : (architectureRuleDomains[path.split("/")[1]] ?? []).map((name) => ({ name, isDirectory: () => true }));

  it("statically validates single-file ESLint plugin wiring", async () => {
    const existingPaths = new Set(architecturePluginSourceFiles);

    await expect(
      validateArchitecturePluginSingleImplementation({
        readPackage: async () => JSON.stringify(packageJson),
        readDirectory: async (path) => domainDirectoryEntries(path),
        pathExists: async (path) => existingPaths.has(path),
      })
    ).resolves.toBeUndefined();

    await expect(
      validateArchitecturePluginSingleImplementation({
        readPackage: async () => JSON.stringify(packageJson),
        readDirectory: async (path) =>
          path === "eslint-plugins"
            ? [...domainDirectoryEntries(path), { name: "resource-heavy-rules.test.mjs", isDirectory: () => false, isFile: () => true }]
            : domainDirectoryEntries(path),
        pathExists: async (path) => existingPaths.has(path),
      })
    ).rejects.toThrow("Remove resource-heavy ESLint plugin rule test files");

    await expect(
      validateArchitecturePluginSingleImplementation({
        readPackage: async () => JSON.stringify(packageJson),
        readDirectory: async (path) =>
          path === "eslint-plugins"
            ? [...domainDirectoryEntries(path), { name: "pass-through-wrapper", isDirectory: () => true }]
            : domainDirectoryEntries(path),
        pathExists: async (path) => existingPaths.has(path),
      })
    ).rejects.toThrow("Move ESLint rule directories into their domain directories");
  });

  it("rejects duplicate plugin sources, generated runtime output, and generator script wiring", async () => {
    const existingPaths = new Set([...architecturePluginSourceFiles, "eslint-plugins/generated"]);

    await expect(
      validateArchitecturePluginSingleImplementation({
        readPackage: async () => JSON.stringify(packageJson),
        readDirectory: async (path) => domainDirectoryEntries(path),
        pathExists: async (path) => existingPaths.has(path),
      })
    ).rejects.toThrow("Remove duplicated generated ESLint plugin runtime directory");

    await expect(
      validateArchitecturePluginSingleImplementation({
        readPackage: async () => JSON.stringify(packageJson),
        readDirectory: async (path) => domainDirectoryEntries(path),
        pathExists: async (path) =>
          [...architecturePluginSourceFiles, "eslint-plugins/svelte/forbidden-component-import/plugin.ts"].includes(path),
      })
    ).rejects.toThrow("Remove duplicated/generated ESLint plugin runtime file");

    await expect(
      validateArchitecturePluginSingleImplementation({
        readPackage: async () =>
          JSON.stringify({
            ...packageJson,
            scripts: { ...packageJson.scripts, "generate:eslint-plugins": "node scripts/generate-eslint-plugin-runtime.mjs" },
          }),
        readDirectory: async (path) => domainDirectoryEntries(path),
        pathExists: async (path) => architecturePluginSourceFiles.includes(path),
      })
    ).rejects.toThrow("Remove generated ESLint plugin runtime script");
  });

  it("rejects internal/source-shaped package imports", async () => {
    await expect(import(packageJson.name)).rejects.toThrow();
    await expect(import(`${packageJson.name}/store`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/middleware`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/init`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/redux-dispatch-bridge`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/components`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/components/use-init-store`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/components/use-run-saga`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/components-svelte`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/components-svelte/index`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/utils/store/create-middleware`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/utils`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/utils/store`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/utils/sagas/safe-local-storage-saga`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/utils/runtime/utils`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/utils/runtime-svelte/utils`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/utils/svelte-selectors/create-selector`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/utils/streaming-selectors/create-selector`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/utils/selector-core/create-cached-selector`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/src/middleware`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/src/middlewares/default`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/src/init`)).rejects.toThrow();
    await expect(import(`${packageJson.name}/src/index`)).rejects.toThrow();
  });
});


describe("validate-release helpers", () => {
  it("normalizes npm pack paths across platforms", () => {
    expect(normalizePath("package\\dist\\index.js")).toBe("dist/index.js");
    expect(normalizePath("package/docs/TESTING.md")).toBe("docs/TESTING.md");
  });

  it("parses npm pack JSON and reports invalid JSON clearly", () => {
    expect(parsePackJson(JSON.stringify(validPack()))).toHaveLength(1);
    expect(() => parsePackJson("not json")).toThrow(ReleaseValidationError);
    expect(() => parsePackJson("not json")).toThrow("Unable to parse npm pack --json output");
  });

  it("accepts expected pack contents without shelling out", () => {
    const logger = vi.fn();

    validatePackContents(validPack(), logger);

    expect(logger).toHaveBeenCalledWith(`[release-validation] checked ${validPack()[0].files.length} packed files`);
  });

  it("covers the complete Markdown source inventory", async () => {
    const existingPaths = new Set(packageMarkdownFiles);

    await expect(validatePackageMarkdownFiles((path) => existingPaths.has(path))).resolves.toBeUndefined();
    existingPaths.delete("docs/WAITFOR.md");
    await expect(validatePackageMarkdownFiles((path) => existingPaths.has(path))).rejects.toThrow(
      "Missing required Markdown document in source tree: docs/WAITFOR.md"
    );
  });

  it("rejects declaration test artifacts, script tests, and generated skill artifacts", () => {
    expect(() =>
      validatePackContents([{ files: [...validPack()[0].files, packEntry("package/dist/foo.test.d.ts")] }])
    ).toThrow("Test declaration artifacts would be packed");

    expect(() =>
      validatePackContents([{ files: [...validPack()[0].files, packEntry("package/skills/_artifacts/cache.json")] }])
    ).toThrow("skills/_artifacts files would be packed");
  });

  it("rejects removed public entrypoint artifacts from pack contents", () => {
    expect(() =>
      validatePackContents([{ files: [...validPack()[0].files, packEntry("package/dist/utils/store/create-middleware.js")] }])
    ).toThrow("Removed public entrypoint artifacts would be packed");

    expect(packageRemovedEntrypointFiles).toEqual(
      expect.arrayContaining(["dist/middleware.js", "dist/init.js", "dist/utils/store/create-middleware.d.ts"])
    );
  });

  it("rejects missing built dist entry points with actionable messages", () => {
    expect(() => validatePackContents(packWithout("dist/svelte-store.js"))).toThrow(
      "Expected dist/svelte-store.js in npm pack dry-run contents. Run npm run build before packing"
    );
  });

  it("rejects missing Markdown documents from pack contents", () => {
    expect(() => validatePackContents(packWithout("docs/WAITFOR.md"))).toThrow(
      "Expected docs/WAITFOR.md in npm pack dry-run contents"
    );
    expect(() => validatePackContents(packWithout("skills/core/SKILL.md"))).toThrow(
      "Expected skills/core/SKILL.md in npm pack dry-run contents"
    );
  });

  it("rejects missing consumer CLI runtime files with actionable messages", () => {
    expect(() => validatePackContents(packWithout("scripts/cli.mjs"))).toThrow(
      "Expected scripts/cli.mjs in npm pack dry-run contents"
    );
  });

  it("rejects unexpected files and missing required package assets", () => {
    expect(() =>
      validatePackContents([{ files: [...validPack()[0].files, packEntry("package/src/index.ts")] }])
    ).toThrow("Unexpected files in npm pack dry-run contents");

    expect(() =>
      validatePackContents([{ files: [...validPack()[0].files, packEntry("package/scripts/package-validation.test.mjs")] }])
    ).toThrow("Script test files would be packed");

    expect(() =>
      validatePackContents([{ files: [...validPack()[0].files, packEntry("package/scripts/validate-release.mjs")] }])
    ).toThrow("Unexpected files in npm pack dry-run contents");

    expect(() =>
      validatePackContents([{ files: [...validPack()[0].files, packEntry("package/eslint-plugins/README.md")] }])
    ).toThrow("Unexpected files in npm pack dry-run contents");

    expect(() =>
      validatePackContents([
        { files: [...validPack()[0].files, packEntry("package/eslint-plugins/store/test-selector-select/fixtures/valid.ts")] },
      ])
    ).toThrow("Unexpected files in npm pack dry-run contents");

    expect(() => validatePackContents([{ files: validPack()[0].files.slice(1) }])).toThrow(
      "Expected package.json in npm pack dry-run contents"
    );
  });

  it("rejects missing packaged validator runtime files with actionable messages", () => {
    expect(() =>
      validatePackContents([{ files: [...validPack()[0].files, packEntry("package/scripts/validate-architecture.mjs")] }])
    ).toThrow("Unexpected files in npm pack dry-run contents");

    expect(() => validatePackContents(packWithout("eslint-plugins/index.mjs"))).toThrow(
      "Expected eslint-plugins/index.mjs in npm pack dry-run contents"
    );

    expect(() => validatePackContents(packWithout("eslint-plugins/ast-utils.mjs"))).toThrow(
      "Expected eslint-plugins/ast-utils.mjs in npm pack dry-run contents"
    );
  });

  it("smoke-tests configured import specifiers with an injectable importer", async () => {
    const namespaceFor = (specifier) => {
      const check = packageImportChecks.find((entry) => entry.specifier === specifier);
      return Object.fromEntries((check?.required ?? []).map((exportName) => [exportName, vi.fn()]));
    };

    const importer = vi.fn(async (specifier, options) => {
      if (packageBlockedImports.includes(specifier)) {
        throw new Error("Package path is not exported");
      }
      return {
        ...namespaceFor(specifier),
        default: specifier.endsWith("/package.json") && options?.with?.type === "json" ? { name: packageName } : {},
      };
    });

    await validateImports(importer);

    expect(importer.mock.calls.map(([specifier]) => specifier)).toEqual([
      ...packageImportChecks.map(({ specifier }) => specifier),
      `${packageName}/package.json`,
      ...packageBlockedImports,
    ]);
  });

  it("includes explicit blocked checks for removed public paths", () => {
    expect(packageBlockedImports).toEqual(
      expect.arrayContaining([
        packageName,
        `${packageName}/store`,
        `${packageName}/middleware`,
        `${packageName}/init`,
        `${packageName}/redux-dispatch-bridge`,
        `${packageName}/utils/store/create-middleware`,
        `${packageName}/utils/svelte-selectors/create-selector`,
        `${packageName}/utils/streaming-selectors/create-selector`,
        `${packageName}/utils/selector-core/create-cached-selector`,
        `${packageName}/src/middleware`,
        `${packageName}/src/middlewares/default`,
        `${packageName}/src/init`,
      ])
    );
  });

  it("fails import smoke validation if an internal path resolves", async () => {
    const importer = vi.fn(async (specifier, options) => {
      const check = packageImportChecks.find((entry) => entry.specifier === specifier);
      return {
        ...Object.fromEntries((check?.required ?? []).map((exportName) => [exportName, vi.fn()])),
        default: specifier.endsWith("/package.json") && options?.with?.type === "json" ? { name: packageName } : {},
      };
    });

    await expect(validateImports(importer)).rejects.toThrow("Unexpected public export for blocked path");
  });

  it("fails import smoke validation if a removed subpackage API resolves", async () => {
    const importer = vi.fn(async (specifier, options) => {
      const check = packageImportChecks.find((entry) => entry.specifier === specifier);
      return {
        ...Object.fromEntries((check?.required ?? []).map((exportName) => [exportName, vi.fn()])),
        ...(specifier === `${packageName}/svelte-store` ? { createMiddleware: vi.fn(), createStoreContext: vi.fn() } : {}),
        default: specifier.endsWith("/package.json") && options?.with?.type === "json" ? { name: packageName } : {},
      };
    });

    await expect(validateImports(importer)).rejects.toThrow("Unexpected public export for removed API");
  });

  it("smoke-tests configured declaration exports with an injectable reader", async () => {
    const declarationFor = ({ required }) => required.map((name) => `export type ${name} = unknown;`).join("\n");
    const declarations = new Map(
      packageTypeExportChecks.map((check) => [check.declarationFile, declarationFor(check)])
    );
    const reader = vi.fn(async (path) => declarations.get(path) ?? "");

    await validateTypeExports(reader);

    expect(reader.mock.calls.map(([path]) => path)).toEqual(
      packageTypeExportChecks.map(({ declarationFile }) => declarationFile)
    );
  });

  it("fails declaration validation if a removed type export resolves", async () => {
    const declarations = new Map(
      packageTypeExportChecks.map((check) => [
        check.declarationFile,
        check.required.map((name) => `export type ${name} = unknown;`).join("\n"),
      ])
    );
    declarations.set("dist/svelte-store.d.ts", `${declarations.get("dist/svelte-store.d.ts")}\nexport type ReduxStore = unknown;`);

    await expect(validateTypeExports(async (path) => declarations.get(path) ?? "")).rejects.toThrow(
      "Unexpected public type export for removed API"
    );
  });

  it("detects named type re-exports in declaration files", () => {
    expect(hasExportedDeclaration('export type { StoreReducer } from "./utils/store/create-reducer";', "StoreReducer")).toBe(true);
    expect(hasExportedDeclaration('type ReduxStore = unknown;', "ReduxStore")).toBe(false);
  });
});
