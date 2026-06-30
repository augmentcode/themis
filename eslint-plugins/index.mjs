import {
  architectureRulePlugins,
  architectureRules,
  coreRulePlugins,
  reactRulePlugins,
  storeRulePlugins,
  svelteRulePlugins,
} from "./plugins/index.mjs";

const pluginNamespace = "themis";

const architectureLanguageOptions = {
  ecmaVersion: "latest",
  sourceType: "module",
  parserOptions: { ecmaFeatures: { jsx: true } },
};

const sourceFiles = ["src/**/*.{js,jsx,mjs,ts,tsx}"];
const reactComponentFiles = ["src/**/*.{jsx,tsx}"];
const svelteStoreIgnores = [
  "src/**/components/**",
  "src/**/component/**",
  "src/**/fixtures/**",
  "src/**/fixture/**",
  "src/**/migrations/**",
  "src/**/migration/**",
];

const ruleDefinitions = {
  "duplicate-action-type": { files: sourceFiles },
  "duplicate-selector-export": { files: sourceFiles },
  "duplicate-selector-implementation": { files: sourceFiles },
  "duplicate-saga-name": { files: sourceFiles },
  "duplicate-saga-registration": { files: sourceFiles },
  "suspicious-state-field": { files: sourceFiles },
  "duplicate-state-field": { files: sourceFiles },
  "component-lifecycle-boundary": { files: sourceFiles },
  "pass-through-wrapper": { files: sourceFiles },
  "non-serializable-state-type": { files: sourceFiles },
  "non-serializable-initial-state": { files: sourceFiles },
  "nondeterministic-reducer-state": { files: sourceFiles },
  "collection-state-shape": { files: sourceFiles },
  "collection-internal-mutation": { files: sourceFiles },
  "reducer-side-effect": { files: sourceFiles },
  "async-reducer-handler": { files: sourceFiles },
  "saga-watcher-action-type": { files: sourceFiles },
  "inline-saga-selector": { files: sourceFiles },
  "saga-local-selector": { files: sourceFiles },
  "no-wildcard-saga-take": { files: sourceFiles },
  "direct-selector-call-mode": { files: sourceFiles },
  "wait-for-named-selector": { files: sourceFiles },
  "typed-saga-yield-star": { files: sourceFiles },
  "auto-forking-channel-helper": { files: sourceFiles },
  "raw-channel-cleanup": { files: sourceFiles },
  "store-constructor-saga-map": { files: sourceFiles },
  "forbidden-component-import": { files: ["src/**/*.svelte"] },
  "source-shaped-package-import": { files: sourceFiles },
  "forbidden-redux-api": { files: sourceFiles },
  "state-type-name": { files: sourceFiles },
  "unnamespaced-action-type": { files: sourceFiles },
  "action-type-shape": { files: sourceFiles },
  "create-action-owner": { files: sourceFiles },
  "direct-local-storage-usage": {
    files: sourceFiles,
    ignores: ["**/examples/utils/safe-local-storage-saga.{js,ts}"],
    languageOptions: {
      ...architectureLanguageOptions,
      globals: { localStorage: "readonly", window: "readonly", globalThis: "readonly", self: "readonly" },
    },
  },
  "selector-file-name": {
    files: sourceFiles,
    ignores: ["src/**/*-selector.{js,jsx,mjs,ts,tsx}", "src/**/*-selectors.{js,jsx,mjs,ts,tsx}"],
  },
  "selector-export-name": {
    files: ["src/**/*-selector.{js,jsx,mjs,ts,tsx}", "src/**/*-selectors.{js,jsx,mjs,ts,tsx}"],
  },
  "removed-middleware-source": {
    files: ["src/middleware.ts", "src/middlewares/**/*.{js,jsx,mjs,ts,tsx}"],
  },
  "shared-svelte-store-boundary": {
    files: ["src/**/*.store.svelte.ts"],
    ignores: svelteStoreIgnores,
  },
  "react-forbidden-component-import": { files: reactComponentFiles },
  "react-component-lifecycle-boundary": { files: reactComponentFiles },
  "react-prefer-direct-selector": { files: reactComponentFiles },
  "shared-react-store-boundary": {
    files: ["src/**/*.store.{ts,tsx}"],
    ignores: svelteStoreIgnores,
  },
  "test-selector-select": { files: ["**/*.{test,spec}.{js,jsx,mjs,ts,tsx}"] },
  "typed-saga-call-mock-guard": { files: ["**/*.{test,spec}.{js,jsx,mjs,ts,tsx}"] },
};

const allRuleIds = Object.keys(ruleDefinitions);
const sharedRootPlugin = { rules: architectureRules };
const namespacedRuleId = (ruleId) => `${pluginNamespace}/${ruleId}`;
const rulesWithSeverity = (severity) => Object.fromEntries(allRuleIds.map((ruleId) => [namespacedRuleId(ruleId), severity]));
const offRules = rulesWithSeverity("off");

const assertConfiguredRulesMatchImplementations = () => {
  const implementationRuleIds = Object.keys(architectureRulePlugins).sort();
  const configuredRuleIds = [...allRuleIds].sort();
  if (implementationRuleIds.join("\0") !== configuredRuleIds.join("\0")) {
    throw new Error("Root ESLint config rule definitions must match architecture rule implementations.");
  }
};

assertConfiguredRulesMatchImplementations();

function baseConfigFor(name) {
  return {
    name: `${pluginNamespace}/${name}`,
    plugins: { [pluginNamespace]: sharedRootPlugin },
    rules: offRules,
  };
}

function ruleConfigFor(ruleId, { includePlugin = false } = {}) {
  const definition = ruleDefinitions[ruleId];
  return {
    name: `${pluginNamespace}/${ruleId}`,
    files: definition.files,
    ...(definition.ignores ? { ignores: definition.ignores } : {}),
    languageOptions: definition.languageOptions ?? architectureLanguageOptions,
    ...(includePlugin ? { plugins: { [pluginNamespace]: sharedRootPlugin } } : {}),
    rules: { [namespacedRuleId(ruleId)]: "warn" },
  };
}

export const plugins = Object.fromEntries(allRuleIds.map((ruleId) => [ruleId, ruleConfigFor(ruleId, { includePlugin: true })]));

function configsFor(name, ruleIds) {
  return [baseConfigFor(name), ...ruleIds.map((ruleId) => ruleConfigFor(ruleId))];
}

const coreRuleIds = Object.keys(coreRulePlugins);
const storeDomainRuleIds = Object.keys(storeRulePlugins);
const svelteDomainRuleIds = Object.keys(svelteRulePlugins);
const reactDomainRuleIds = Object.keys(reactRulePlugins);

const assertDomainGroupingsCoverAllRules = () => {
  const domainRuleIds = [...coreRuleIds, ...storeDomainRuleIds, ...svelteDomainRuleIds, ...reactDomainRuleIds].sort();
  if (domainRuleIds.join("\0") !== [...allRuleIds].sort().join("\0")) {
    throw new Error("Domain rule groupings must cover every architecture rule implementation exactly once.");
  }
};

assertDomainGroupingsCoverAllRules();

const storeRuleIds = [...coreRuleIds, ...storeDomainRuleIds];

export const core = configsFor("core", coreRuleIds);
export const store = configsFor("store", storeRuleIds);
export const svelte = configsFor("svelte", [...storeRuleIds, ...svelteDomainRuleIds]);
export const react = configsFor("react", [...storeRuleIds, ...reactDomainRuleIds]);
export const streaming = configsFor("streaming", storeRuleIds);