#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
export const packageName = "@augmentcode/themis";

export const nativeReplacedArchitectureRuleIds = [];

export const standaloneArchitectureRuleIds = [
  "action-type-shape",
  "async-reducer-handler",
  "auto-forking-channel-helper",
  "collection-internal-mutation",
  "collection-state-shape",
  "component-lifecycle-boundary",
  "create-action-owner",
  "direct-local-storage-usage",
  "direct-selector-call-mode",
  "duplicate-action-type",
  "duplicate-saga-name",
  "duplicate-saga-registration",
  "duplicate-selector-export",
  "duplicate-selector-implementation",
  "duplicate-state-field",
  "forbidden-component-import",
  "forbidden-redux-api",
  "inline-saga-selector",
  "no-extra-selector-caching",
  "no-wildcard-saga-take",
  "non-serializable-initial-state",
  "non-serializable-state-type",
  "nondeterministic-reducer-state",
  "pass-through-wrapper",
  "raw-channel-cleanup",
  "react-component-lifecycle-boundary",
  "react-forbidden-component-import",
  "react-prefer-direct-selector",
  "reducer-side-effect",
  "removed-middleware-source",
  "saga-local-selector",
  "saga-watcher-action-type",
  "selector-argument-stability",
  "selector-export-name",
  "selector-file-name",
  "shared-react-store-boundary",
  "shared-svelte-store-boundary",
  "camelcase-slice-identity",
  "single-slice-selectors-module",
  "source-shaped-package-import",
  "state-type-name",
  "store-constructor-saga-map",
  "suspicious-state-field",
  "test-selector-select",
  "typed-saga-call-mock-guard",
  "typed-saga-yield-star",
  "unnamespaced-action-type",
  "wait-for-named-selector",
];

export const architectureRuleDomains = {
  core: [
    "source-shaped-package-import",
    "forbidden-redux-api",
    "pass-through-wrapper",
    "removed-middleware-source",
  ],
  store: [
    "duplicate-action-type",
    "duplicate-selector-export",
    "duplicate-selector-implementation",
    "suspicious-state-field",
    "duplicate-state-field",
    "non-serializable-state-type",
    "non-serializable-initial-state",
    "nondeterministic-reducer-state",
    "collection-state-shape",
    "collection-internal-mutation",
    "reducer-side-effect",
    "async-reducer-handler",
    "state-type-name",
    "unnamespaced-action-type",
    "action-type-shape",
    "camelcase-slice-identity",
    "create-action-owner",
    "selector-file-name",
    "selector-export-name",
    "single-slice-selectors-module",
    "direct-selector-call-mode",
    "test-selector-select",
    "duplicate-saga-name",
    "duplicate-saga-registration",
    "saga-watcher-action-type",
    "inline-saga-selector",
    "saga-local-selector",
    "no-extra-selector-caching",
    "selector-argument-stability",
    "no-wildcard-saga-take",
    "wait-for-named-selector",
    "typed-saga-yield-star",
    "auto-forking-channel-helper",
    "raw-channel-cleanup",
    "store-constructor-saga-map",
    "direct-local-storage-usage",
    "typed-saga-call-mock-guard",
  ],
  svelte: ["forbidden-component-import", "component-lifecycle-boundary", "shared-svelte-store-boundary"],
  react: [
    "react-forbidden-component-import",
    "react-component-lifecycle-boundary",
    "react-prefer-direct-selector",
    "shared-react-store-boundary",
  ],
};

export const architectureRuleDomainById = Object.fromEntries(
  Object.entries(architectureRuleDomains).flatMap(([domain, ruleIds]) => ruleIds.map((ruleId) => [ruleId, domain]))
);

export const architecturePluginRuntimeRuleIds = [...standaloneArchitectureRuleIds].sort();

export const architecturePluginBlockedRuleIds = [...standaloneArchitectureRuleIds, ...nativeReplacedArchitectureRuleIds].sort();

export const architecturePluginSourceFiles = architecturePluginRuntimeRuleIds.map(
  (ruleId) => `eslint-plugins/${architectureRuleDomainById[ruleId]}/${ruleId}/plugin.mjs`
);

export const generatedArchitecturePluginRuntimeFiles = architecturePluginRuntimeRuleIds.map(
  (ruleId) => `eslint-plugins/generated/${ruleId}.mjs`
);

export const forbiddenArchitecturePluginDuplicateFiles = [
  "scripts/generate-eslint-plugin-runtime.mjs",
  ...architecturePluginBlockedRuleIds.map((ruleId) => `eslint-plugins/${architectureRuleDomainById[ruleId]}/${ruleId}/plugin.ts`),
  ...architecturePluginBlockedRuleIds.map((ruleId) => `eslint-plugins/plugins/${ruleId}.mjs`),
  ...architecturePluginBlockedRuleIds.map((ruleId) => `eslint-plugins/generated/${ruleId}.mjs`),
  ...nativeReplacedArchitectureRuleIds.map((ruleId) => `eslint-plugins/${architectureRuleDomainById[ruleId]}/${ruleId}/plugin.mjs`),
];

export const architecturePluginRuntimeFiles = [
  "eslint-plugins/plugins/index.mjs",
  ...architecturePluginSourceFiles,
];

export const packageRuntimeFiles = [
  "scripts/cli.mjs",
  "scripts/postinstall.mjs",
  "scripts/cleanup-skills.mjs",
  "eslint-plugins/index.mjs",
  "eslint-plugins/ast-utils.mjs",
  "eslint-plugins/component-import-utils.mjs",
  "eslint-plugins/rule-utils.mjs",
  ...architecturePluginRuntimeFiles,
];

export const packageEntrypointFiles = [
  "dist/svelte-store.js",
  "dist/svelte-store.d.ts",
  "dist/streaming-store.js",
  "dist/streaming-store.d.ts",
  "dist/react-store.js",
  "dist/react-store.d.ts",
  "dist/saga.js",
  "dist/saga.d.ts",
  "dist/types.js",
  "dist/types.d.ts",
  "dist/components-svelte/use-init-store.js",
  "dist/components-svelte/use-init-store.d.ts",
  "dist/components-svelte/use-run-saga.js",
  "dist/components-svelte/use-run-saga.d.ts",
  "dist/utils/collections/collection-utils.js",
  "dist/utils/collections/collection-utils.d.ts",
  "dist/utils/store/create-action.js",
  "dist/utils/store/create-action.d.ts",
  "dist/utils/store/create-reducer.js",
  "dist/utils/store/create-reducer.d.ts",
  "dist/utils/store/boolean-preference.js",
  "dist/utils/store/boolean-preference.d.ts",
  "dist/utils/store/domain-scoped.js",
  "dist/utils/store/domain-scoped.d.ts",
  "dist/utils/sagas/debounce-saga.js",
  "dist/utils/sagas/debounce-saga.d.ts",
  "dist/utils/sagas/retry-with-timeout.js",
  "dist/utils/sagas/retry-with-timeout.d.ts",
  "dist/utils/sagas/wrap-async-generator.js",
  "dist/utils/sagas/wrap-async-generator.d.ts",
  "dist/utils/sagas/selector-channel-effects.js",
  "dist/utils/sagas/selector-channel-effects.d.ts",
];

export const packageMarkdownFiles = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/ARCHITECTURE.md",
  "docs/COLLECTIONS.md",
  "docs/INSTALLATION.md",
  "docs/REDUCERS.md",
  "docs/SAGAS.md",
  "docs/SELECTORS.md",
  "docs/TESTING.md",
  "docs/WAITFOR.md",
  "skills/SKILL.md",
  "skills/core/SKILL.md",
  "skills/core/actions/SKILL.md",
  "skills/core/boolean-preference/SKILL.md",
  "skills/core/channel-effects/SKILL.md",
  "skills/core/collections/SKILL.md",
  "skills/core/core-policy/SKILL.md",
  "skills/core/debugging/SKILL.md",
  "skills/core/domain-scoped-state/SKILL.md",
  "skills/core/file-structure/SKILL.md",
  "skills/core/import-boundaries/SKILL.md",
  "skills/core/local-storage/SKILL.md",
  "skills/core/reducers/SKILL.md",
  "skills/core/redux-saga/SKILL.md",
  "skills/core/saga-manager/SKILL.md",
  "skills/core/sagas/SKILL.md",
  "skills/core/selector-channels/SKILL.md",
  "skills/core/state-integrity/SKILL.md",
  "skills/core/state-serialization/SKILL.md",
  "skills/core/store-pruning/SKILL.md",
  "skills/core/testing/SKILL.md",
  "skills/core/verifier/SKILL.md",
  "skills/core/wait-for/SKILL.md",
  "skills/react/SKILL.md",
  "skills/react/component-integration/SKILL.md",
  "skills/react/migration/SKILL.md",
  "skills/react/migration/assessment/SKILL.md",
  "skills/react/migration/cleanup/SKILL.md",
  "skills/react/migration/component-migration/SKILL.md",
  "skills/react/migration/derived-stores/SKILL.md",
  "skills/react/migration/setup/SKILL.md",
  "skills/react/migration/side-effects/SKILL.md",
  "skills/react/migration/writable-stores/SKILL.md",
  "skills/react/selector-lifecycle/SKILL.md",
  "skills/react/selector-scheduling/SKILL.md",
  "skills/react/selectors/SKILL.md",
  "skills/react/signals/SKILL.md",
  "skills/react/store/SKILL.md",
  "skills/setup/SKILL.md",
  "skills/streaming/SKILL.md",
  "skills/streaming/selector-lifecycle/SKILL.md",
  "skills/streaming/selectors/SKILL.md",
  "skills/streaming/store/SKILL.md",
  "skills/svelte/SKILL.md",
  "skills/svelte/component-integration/SKILL.md",
  "skills/svelte/migration/SKILL.md",
  "skills/svelte/migration/assessment/SKILL.md",
  "skills/svelte/migration/cleanup/SKILL.md",
  "skills/svelte/migration/component-migration/SKILL.md",
  "skills/svelte/migration/derived-stores/SKILL.md",
  "skills/svelte/migration/setup/SKILL.md",
  "skills/svelte/migration/side-effects/SKILL.md",
  "skills/svelte/migration/writable-stores/SKILL.md",
  "skills/svelte/selector-lifecycle/SKILL.md",
  "skills/svelte/selector-scheduling/SKILL.md",
  "skills/svelte/selectors/SKILL.md",
  "skills/svelte/store/SKILL.md",
];

export const packageRemovedEntrypointFiles = [
  "dist/middleware.js",
  "dist/middleware.d.ts",
  "dist/init.js",
  "dist/init.d.ts",
  "dist/utils/store/create-middleware.js",
  "dist/utils/store/create-middleware.d.ts",
];

const svelteStoreBlockedExports = [
  "SvelteStore",
  "StreamingStore",
  "createAction",
  "createAsyncAction",
  "createReducer",
  "createDomainScopedHelpers",
  "createBooleanPreference",
  "createCollection",
  "addItem",
  "addItemAndCountRef",
  "addItemAt",
  "addItems",
  "decreaseRefsCount",
  "filterCollection",
  "filterItems",
  "findItem",
  "getItem",
  "getItems",
  "getRefsCount",
  "increaseRefsCount",
  "removeItem",
  "replaceItem",
  "updateItem",
  "upsertItem",
  "upsertItemAndCountRef",
  "useInitStore",
  "getReduxStore",
  "createCachedSelector",
  "lockUpdates",
  "unlockUpdates",
  "init",
  "createExtendedDefaultState",
  "createSelector",
  "getStoreContext",
  "createStoreStateReadable",
  "storeUtilityReducer",
  "selectUpdatesLocked",
  "STORE_CONTEXT",
  "assertValue",
  "omitKey",
  "createThrottledReadable",
  "collectionFieldsSet",
  "deduplicateCollection",
  "findLastItem",
  "getItemIndex",
  "getLastItem",
  "isCollection",
  "purgeCollection",
  "replaceItems",
  "createMiddleware",
  "createStoreContext",
  "createReduxStoreContext",
];

export const packageImportChecks = [
  {
    specifier: `${packageName}/svelte-store`,
    required: ["Store", "getDispatch"],
    blocked: svelteStoreBlockedExports,
  },
  {
    specifier: `${packageName}/streaming-store`,
    required: ["StreamingStore"],
    blocked: [
      "Store",
      "SvelteStore",
      "createAction",
      "createAsyncAction",
      "createReducer",
      "createDomainScopedHelpers",
      "createBooleanPreference",
      "createCollection",
      "useInitStore",
      "useRunSaga",
      "createSelector",
      "createCachedSelector",
    ],
  },
  {
    specifier: `${packageName}/react-store`,
    required: ["ReactStore"],
    blocked: [
      "Store",
      "SvelteStore",
      "StreamingStore",
      "createAction",
      "createAsyncAction",
      "createReducer",
      "createSelector",
      "createCachedSelector",
    ],
  },
  {
    specifier: `${packageName}/saga`,
    required: [
      "waitFor",
      "debounceSaga",
      "retryWithTimeout",
      "wrapStreamingGenerator",
      "createChannelFromSelector",
      "takeEveryFromSelector",
      "takeLatestFromSelector",
      "takeLeadingFromSelector",
    ],
    blocked: [
      "useRunSaga",
      "runSagaHelper",
      "startSaga",
      "stopSaga",
      "sagaManager",
      "getBackOffDelay",
      "lockReactiveSelectors",
      "StreamTimeoutError",
      "debounceWithKeySaga",
      "getLocalStorageItem",
      "setLocalStorageItem",
      "removeLocalStorageItem",
      "getLocalStorageKeysWithPrefix",
      "getLocalStorageJSON",
      "setLocalStorageJSON",
    ],
  },
  {
    specifier: `${packageName}/types`,
    required: [],
    blocked: [],
  },
  {
    specifier: `${packageName}/components-svelte/use-init-store`,
    required: ["useInitStore"],
    blocked: [],
  },
  {
    specifier: `${packageName}/components-svelte/use-run-saga`,
    required: ["useRunSaga"],
    blocked: [],
  },
  {
    specifier: `${packageName}/utils/collections/collection-utils`,
    required: ["createCollection", "addItem", "getItems", "getItem"],
    blocked: [],
  },
  {
    specifier: `${packageName}/utils/store/create-action`,
    required: ["createAction", "createAsyncAction"],
    blocked: [],
  },
  {
    specifier: `${packageName}/utils/store/create-reducer`,
    required: ["createReducer"],
    blocked: [],
  },
  {
    specifier: `${packageName}/utils/store/boolean-preference`,
    required: ["createBooleanPreference"],
    blocked: [],
  },
  {
    specifier: `${packageName}/utils/store/domain-scoped`,
    required: ["createDomainScopedHelpers"],
    blocked: [],
  },
  {
    specifier: `${packageName}/utils/sagas/debounce-saga`,
    required: ["debounceSaga", "debounceWithKeySaga"],
    blocked: [],
  },
  {
    specifier: `${packageName}/utils/sagas/retry-with-timeout`,
    required: ["retryWithTimeout"],
    blocked: [],
  },
  {
    specifier: `${packageName}/utils/sagas/wrap-async-generator`,
    required: ["wrapStreamingGenerator", "StreamTimeoutError"],
    blocked: [],
  },
  {
    specifier: `${packageName}/utils/sagas/selector-channel-effects`,
    required: ["createChannelFromSelector", "takeEveryFromSelector", "takeLatestFromSelector", "takeLeadingFromSelector"],
    blocked: [],
  },
  {
    specifier: `${packageName}/eslint-plugins`,
    required: ["core", "store", "plugins", "svelte", "react", "streaming"],
    blocked: [
      "full",
      "recommended",
      "architectureConfig",
      "architecturePlugin",
      "architectureRules",
      "architectureRulePlugins",
      "architectureLanguageOptions",
      "architectureSourceFiles",
      "architectureTestFiles",
      "nativeReplacedArchitectureRuleIds",
      "createArchitectureConfig",
      "createArchitectureFlatConfig",
      "createNativeArchitectureReplacementConfigs",
      "createArchitectureRuleConfig",
      "architectureEslintCompatibilityPlan",
    ],
  },
  {
    specifier: `${packageName}/eslint-plugins/plugins`,
    required: ["architectureRulePlugins", "passThroughWrapperPlugin"],
    blocked: [
      "normalizeArchitectureRuleSeverity",
      "ruleConfigForPlugins",
      "createArchitectureRuleConfig",
      "aggregateCheckRuleConfig",
      "sourceBoundaryRuleConfig",
      "stateCollectionReducerRuleConfig",
      "sagaSelectorChannelRuleConfig",
      "testPatternRuleConfig",
    ],
  },
  ...standaloneArchitectureRuleIds.map((ruleId) => ({
    specifier: `${packageName}/eslint-plugins/plugins/${ruleId}`,
    required: ["plugin", "rule", "ruleId"],
    blocked: [],
  })),
];

export const packageTypeExportChecks = [
  {
    declarationFile: "dist/svelte-store.d.ts",
    required: ["Store", "getDispatch"],
    blocked: [
      "SvelteStore",
      "StreamingStore",
      "StoreReducer",
      "BooleanPreferenceReducerBuilder",
      "Collection",
      "RefsCounter",
      "StoreUtilityState",
      "CreateSelector",
      "GenericAction",
      "PayloadModifier",
      "PreloadedStoreState",
      "ReadableArgs",
      "ReducersMap",
      "ReduxStore",
      "ReduxStoreContext",
      "StateDomain",
      "StoreAction",
      "StoreActionCreator",
      "StoreAsyncAction",
      "StoreAsyncActionCreator",
      "StoreReducerFunction",
      "StoreSelector",
      "StoreSelectorCallback",
      "StoreSelectorEffect",
      "StoreSelectorReadable",
      "StoreSelectorSelect",
      "StoreSelectorWithStore",
      "StoreState",
    ],
  },
  {
    declarationFile: "dist/streaming-store.d.ts",
    required: ["StreamingStore"],
    blocked: ["Store", "SvelteStore", "StoreReducer", "CreateSelector", "StoreSelector"],
  },
  {
    declarationFile: "dist/react-store.d.ts",
    required: ["ReactStore"],
    blocked: ["Store", "SvelteStore", "StreamingStore", "StoreReducer", "CreateSelector", "StoreSelector"],
  },
  {
    declarationFile: "dist/saga.d.ts",
    required: [
      "RetryWithTimeoutOptions",
      "RetryWithTimeoutOutcome",
      "WrapStreamingGeneratorOptions",
      "SelectorChannelPayload",
      "SelectorWorkerSaga",
    ],
    blocked: ["SagaManagerContext"],
  },
  {
    declarationFile: "dist/types.d.ts",
    required: [
      "ReducersMap",
      "StoreReducerFunction",
      "StoreReducerState",
      "StoreStateFromReducers",
      "StoreState",
      "PreloadedStoreState",
      "StoreAction",
      "GenericAction",
      "PayloadModifier",
      "StoreActionCreator",
      "StoreAsyncAction",
      "StoreAsyncActionCreator",
      "SuccessResponse",
      "ErrorResponse",
      "MiddlewareFunction",
      "StoreMiddleware",
      "CreateSelector",
      "ReadableArgs",
      "StoreSelector",
      "StoreSelectorCallback",
      "StoreSelectorEffect",
      "StoreSelectorReadable",
      "StoreSelectorSelect",
    ],
    blocked: [
      "ReduxStoreContext",
      "ReduxStore",
      "StoreSelectorWithStore",
      "SagaCrashRecord",
      "SagaStatusRecord",
      "StateDomain",
    ],
  },
  {
    declarationFile: "dist/components-svelte/use-init-store.d.ts",
    required: ["useInitStore"],
    blocked: [],
  },
  {
    declarationFile: "dist/components-svelte/use-run-saga.d.ts",
    required: ["useRunSaga"],
    blocked: [],
  },
  {
    declarationFile: "dist/utils/collections/collection-utils.d.ts",
    required: ["Collection", "RefsCounter", "createCollection"],
    blocked: [],
  },
  {
    declarationFile: "dist/utils/store/create-action.d.ts",
    required: ["createAction", "createAsyncAction"],
    blocked: [],
  },
  {
    declarationFile: "dist/utils/store/create-reducer.d.ts",
    required: ["StoreReducer", "createReducer"],
    blocked: [],
  },
  {
    declarationFile: "dist/utils/store/boolean-preference.d.ts",
    required: ["BooleanPreferenceReducerBuilder", "createBooleanPreference"],
    blocked: [],
  },
  {
    declarationFile: "dist/utils/store/domain-scoped.d.ts",
    required: ["createDomainScopedHelpers"],
    blocked: ["DomainScopedState"],
  },
  {
    declarationFile: "dist/utils/sagas/debounce-saga.d.ts",
    required: ["debounceSaga", "debounceWithKeySaga"],
    blocked: [],
  },
  {
    declarationFile: "dist/utils/sagas/retry-with-timeout.d.ts",
    required: ["RetryWithTimeoutOptions", "RetryWithTimeoutOutcome", "retryWithTimeout"],
    blocked: [],
  },
  {
    declarationFile: "dist/utils/sagas/wrap-async-generator.d.ts",
    required: ["StreamTimeoutError", "WrapStreamingGeneratorOptions", "wrapStreamingGenerator"],
    blocked: [],
  },
  {
    declarationFile: "dist/utils/sagas/selector-channel-effects.d.ts",
    required: ["SelectorChannelPayload", "SelectorWorkerSaga", "createChannelFromSelector", "takeEveryFromSelector"],
    blocked: [],
  },
];

export const packageBlockedImports = [
  packageName,
  `${packageName}/store`,
  `${packageName}/middleware`,
  `${packageName}/init`,
  `${packageName}/redux-dispatch-bridge`,
  `${packageName}/components`,
  `${packageName}/components/use-init-store`,
  `${packageName}/components/use-run-saga`,
  `${packageName}/components-svelte`,
  `${packageName}/components-svelte/index`,
  `${packageName}/utils/store/create-middleware`,
  `${packageName}/utils`,
  `${packageName}/utils/store`,
  `${packageName}/utils/store/index`,
  `${packageName}/utils/collections`,
  `${packageName}/utils/collections/index`,
  `${packageName}/utils/sagas`,
  `${packageName}/utils/sagas/index`,
  `${packageName}/utils/sagas/safe-local-storage-saga`,
  `${packageName}/utils/runtime/utils`,
  `${packageName}/utils/runtime-svelte/utils`,
  `${packageName}/utils/svelte-selectors`,
  `${packageName}/utils/svelte-selectors/index`,
  `${packageName}/utils/svelte-selectors/create-selector`,
  `${packageName}/utils/svelte-selectors/create-readable-store-state`,
  `${packageName}/utils/svelte-selectors/selector-scheduler`,
  `${packageName}/utils/streaming-selectors`,
  `${packageName}/utils/streaming-selectors/index`,
  `${packageName}/utils/streaming-selectors/create-selector`,
  `${packageName}/utils/react-selectors`,
  `${packageName}/utils/react-selectors/index`,
  `${packageName}/utils/react-selectors/create-selector`,
  `${packageName}/utils/react-selectors/selector-scheduler`,
  `${packageName}/utils/selector-core`,
  `${packageName}/utils/selector-core/index`,
  `${packageName}/utils/selector-core/create-cached-selector`,
  `${packageName}/utils/selector-core/store-update-lock`,
  `${packageName}/src/middleware`,
  `${packageName}/src/middleware.ts`,
  `${packageName}/src/middlewares/default`,
  `${packageName}/src/middlewares/saga`,
  `${packageName}/src/middlewares/state-reference-checks`,
  `${packageName}/src/init`,
  `${packageName}/src/init.ts`,
  `${packageName}/src/index`,
  `${packageName}/eslint-architecture`,
  `${packageName}/eslint-architecture/plugins`,
  ...architecturePluginBlockedRuleIds.map((ruleId) => `${packageName}/eslint-architecture/plugins/${ruleId}`),
  ...nativeReplacedArchitectureRuleIds.map((ruleId) => `${packageName}/eslint-plugins/plugins/${ruleId}`),
];

const packageRuntimeFileSet = new Set(packageRuntimeFiles);

export class ReleaseValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseValidationError";
  }
}

function log(message) {
  console.log(`\n[release-validation] ${message}`);
}

function fail(message) {
  console.error(`\n[release-validation] ${message}`);
  process.exit(1);
}

function validationError(message) {
  return new ReleaseValidationError(message);
}

async function defaultPathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function validatePackageMarkdownFiles(pathExists = defaultPathExists) {
  for (const file of packageMarkdownFiles) {
    if (!(await pathExists(file))) {
      throw validationError(`Missing required Markdown document in source tree: ${file}`);
    }
  }
}

function assertArrayEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw validationError(`${message}\nExpected: ${expected.join("\n")}\nActual: ${actual.join("\n")}`);
  }
}

function assertPackageExportTarget(packageJson, exportPath, expectedTarget) {
  const target = packageJson.exports?.[exportPath];
  if (!target) {
    throw validationError(`Missing package export ${exportPath}`);
  }
  if (target.import !== expectedTarget || target.default !== expectedTarget) {
    throw validationError(`Package export ${exportPath} must target ${expectedTarget}`);
  }
}

function assertPackageExportAbsent(packageJson, exportPath) {
  if (packageJson.exports?.[exportPath]) {
    throw validationError(`Unexpected package export ${exportPath}`);
  }
}

export async function validateArchitecturePluginSingleImplementation({
  readPackage = (path) => readFile(path, "utf8"),
  readDirectory = readdir,
  pathExists = defaultPathExists,
} = {}) {
  const packageJson = JSON.parse(await readPackage("package.json"));
  const activeRuleIds = [...standaloneArchitectureRuleIds].sort();
  const entries = await readDirectory("eslint-plugins", { withFileTypes: true });
  const rootRuleDirs = entries
    .filter((entry) => entry.isDirectory() && architecturePluginBlockedRuleIds.includes(entry.name))
    .map((entry) => `eslint-plugins/${entry.name}`)
    .sort();
  const activeRuleDirs = [];
  const nativeReplacedRuleDirs = [];
  for (const [domain, ruleIds] of Object.entries(architectureRuleDomains)) {
    const domainPath = `eslint-plugins/${domain}`;
    if (ruleIds.length === 0 && !(await pathExists(domainPath))) continue;
    const domainEntries = await readDirectory(domainPath, { withFileTypes: true });
    activeRuleDirs.push(
      ...domainEntries.filter((entry) => entry.isDirectory() && ruleIds.includes(entry.name)).map((entry) => entry.name)
    );
    nativeReplacedRuleDirs.push(
      ...domainEntries
        .filter((entry) => entry.isDirectory() && nativeReplacedArchitectureRuleIds.includes(entry.name))
        .map((entry) => `${domainPath}/${entry.name}`)
    );
  }
  activeRuleDirs.sort();
  nativeReplacedRuleDirs.sort();
  const eslintPluginTestFiles = entries
    .filter((entry) => entry.isFile?.() && /\.test\.mjs$/.test(entry.name))
    .map((entry) => `eslint-plugins/${entry.name}`)
    .sort();

  if (rootRuleDirs.length > 0) {
    throw validationError(`Move ESLint rule directories into their domain directories:\n${rootRuleDirs.join("\n")}`);
  }
  assertArrayEqual(activeRuleDirs, activeRuleIds, "Active ESLint rule directories must match the release rule list.");
  if (nativeReplacedRuleDirs.length > 0) {
    throw validationError(`Remove native-replaced ESLint rule directories:\n${nativeReplacedRuleDirs.join("\n")}`);
  }
  if (eslintPluginTestFiles.length > 0) {
    throw validationError(`Remove resource-heavy ESLint plugin rule test files:\n${eslintPluginTestFiles.join("\n")}`);
  }

  if (new Set(architecturePluginSourceFiles).size !== architecturePluginRuntimeRuleIds.length) {
    throw validationError("Each active ESLint rule must have exactly one configured plugin.mjs implementation file.");
  }

  for (const file of architecturePluginSourceFiles) {
    if (!(await pathExists(file))) {
      throw validationError(`Missing canonical ESLint plugin implementation: ${file}`);
    }
  }

  if (await pathExists("eslint-plugins/generated")) {
    throw validationError("Remove duplicated generated ESLint plugin runtime directory: eslint-plugins/generated");
  }

  for (const file of forbiddenArchitecturePluginDuplicateFiles) {
    if (await pathExists(file)) {
      throw validationError(`Remove duplicated/generated ESLint plugin runtime file: ${file}`);
    }
  }

  const scriptEntries = Object.entries(packageJson.scripts ?? {});
  if (packageJson.scripts?.["generate:eslint-plugins"]) {
    throw validationError("Remove generated ESLint plugin runtime script: generate:eslint-plugins");
  }
  const generatorScript = scriptEntries.find(([, command]) =>
    /generate:eslint-plugins|generate-eslint-plugin-runtime|eslint-plugins\/generated/.test(command)
  );
  if (generatorScript) {
    throw validationError(`Remove generated ESLint plugin runtime wiring from npm script ${generatorScript[0]}`);
  }
  if (packageRuntimeFiles.includes("scripts/generate-eslint-plugin-runtime.mjs")) {
    throw validationError("Generated ESLint plugin runtime generator must not be packaged.");
  }

  assertPackageExportTarget(packageJson, "./eslint-plugins", "./eslint-plugins/index.mjs");
  assertPackageExportTarget(packageJson, "./eslint-plugins/plugins", "./eslint-plugins/plugins/index.mjs");
  assertPackageExportAbsent(packageJson, "./eslint-architecture");
  assertPackageExportAbsent(packageJson, "./eslint-architecture/plugins");

  for (const ruleId of standaloneArchitectureRuleIds) {
    const implementation = `./eslint-plugins/${architectureRuleDomainById[ruleId]}/${ruleId}/plugin.mjs`;
    assertPackageExportTarget(packageJson, `./eslint-plugins/plugins/${ruleId}`, implementation);
    assertPackageExportAbsent(packageJson, `./eslint-architecture/plugins/${ruleId}`);
  }

  for (const ruleId of nativeReplacedArchitectureRuleIds) {
    assertPackageExportAbsent(packageJson, `./eslint-plugins/plugins/${ruleId}`);
    assertPackageExportAbsent(packageJson, `./eslint-architecture/plugins/${ruleId}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) console.log(result.stdout.trimEnd());
      if (result.stderr) console.error(result.stderr.trimEnd());
    }
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result;
}

export function parsePackJson(stdout) {
  try {
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw validationError(`Unable to parse npm pack --json output: ${error.message}`);
  }
}

export function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/^package\//, "");
}

function assertPacked(paths, expectedPath, guidance = "") {
  if (!paths.has(expectedPath)) {
    throw validationError(`Expected ${expectedPath} in npm pack dry-run contents${guidance}`);
  }
}

export function validatePackContents(packages, logger = console.log) {
  if (!Array.isArray(packages) || packages.length !== 1) {
    throw validationError("Expected npm pack --dry-run --json to return exactly one package");
  }

  const files = packages[0].files ?? [];
  const paths = new Set(files.map((file) => normalizePath(file.path)));

  const scriptTests = [...paths].filter((path) => /^scripts\/.*\.test\.mjs$/.test(path));
  if (scriptTests.length > 0) {
    throw validationError(`Script test files would be packed:\n${scriptTests.join("\n")}`);
  }

  const eslintPluginTests = [...paths].filter((path) => /^eslint-plugins\/.*\.test\.mjs$/.test(path));
  if (eslintPluginTests.length > 0) {
    throw validationError(`ESLint plugin test files would be packed:\n${eslintPluginTests.join("\n")}`);
  }

  const invalidPaths = [...paths].filter((path) => {
    return !(
      path === "package.json" ||
      path === "README.md" ||
      path === "CONTRIBUTING.md" ||
      path === "LICENSE" ||
      path === "LICENSE.md" ||
      packageRuntimeFileSet.has(path) ||
      path.startsWith("dist/") ||
      path.startsWith("docs/") ||
      path.startsWith("skills/")
    );
  });

  if (invalidPaths.length > 0) {
    throw validationError(`Unexpected files in npm pack dry-run contents:\n${invalidPaths.join("\n")}`);
  }

  const testDeclarations = [...paths].filter((path) => /\.test\.d\.ts(\.map)?$/.test(path));
  if (testDeclarations.length > 0) {
    throw validationError(`Test declaration artifacts would be packed:\n${testDeclarations.join("\n")}`);
  }

  const removedEntrypoints = packageRemovedEntrypointFiles.filter((path) => paths.has(path));
  if (removedEntrypoints.length > 0) {
    throw validationError(`Removed public entrypoint artifacts would be packed:\n${removedEntrypoints.join("\n")}`);
  }

  const skillArtifacts = [...paths].filter((path) => path.startsWith("skills/_artifacts/"));
  if (skillArtifacts.length > 0) {
    throw validationError(`skills/_artifacts files would be packed:\n${skillArtifacts.join("\n")}`);
  }

  assertPacked(paths, "package.json");
  assertPacked(paths, "README.md");
  const distGuidance = ". Run npm run build before packing and verify package.json's files array includes dist/.";
  for (const file of packageEntrypointFiles) {
    assertPacked(paths, file, distGuidance);
  }
  const scriptGuidance = ". Verify package.json's files array includes architecture validation runtime scripts and eslint-plugins/ runtime files while excluding tests.";
  for (const file of packageRuntimeFiles) {
    assertPacked(paths, file, scriptGuidance);
  }
  const markdownGuidance = ". Verify package.json's files array includes the complete docs/ and skills/ Markdown inventory.";
  for (const file of packageMarkdownFiles) {
    assertPacked(paths, file, markdownGuidance);
  }

  if (![...paths].some((path) => path.startsWith("docs/"))) {
    throw validationError("Expected docs/ files in npm pack dry-run contents");
  }
  if (![...paths].some((path) => path.startsWith("skills/"))) {
    throw validationError("Expected skills/ files in npm pack dry-run contents");
  }

  logger(`[release-validation] checked ${paths.size} packed files`);
}

export async function validateImports(importPackage = (specifier, options) => import(specifier, options)) {
  for (const { specifier, required, blocked } of packageImportChecks) {
    const namespace = await importPackage(specifier);
    for (const exportName of required) {
      if (!(exportName in namespace)) {
        throw validationError(`Missing expected public export ${specifier}#${exportName}`);
      }
    }
    for (const exportName of blocked) {
      if (exportName in namespace) {
        throw validationError(`Unexpected public export for removed API: ${specifier}#${exportName}`);
      }
    }
    console.log(`[release-validation] import ok: ${specifier}`);
  }

  const packageJson = await importPackage(`${packageName}/package.json`, {
    with: { type: "json" },
  });
  if (packageJson.default?.name !== packageName) {
    throw validationError(`${packageName}/package.json import returned unexpected package name`);
  }
  console.log(`[release-validation] import ok: ${packageName}/package.json`);

  for (const specifier of packageBlockedImports) {
    let rejected = false;
    try {
      await importPackage(specifier);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw validationError(`Unexpected public export for blocked path: ${specifier}`);
    }
    console.log(`[release-validation] import blocked: ${specifier}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasExportedDeclaration(source, exportName) {
  const name = escapeRegExp(exportName);
  return (
    new RegExp(`export\\s+(?:declare\\s+)?(?:type|interface|class|function|const|let|var|enum)\\s+${name}\\b`).test(source) ||
    new RegExp(`export\\s+type\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source) ||
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source)
  );
}

export async function validateTypeExports(readDeclaration = (path) => readFile(path, "utf8")) {
  for (const { declarationFile, required, blocked } of packageTypeExportChecks) {
    const source = await readDeclaration(declarationFile);
    for (const exportName of required) {
      if (!hasExportedDeclaration(source, exportName)) {
        throw validationError(`Missing expected public type export ${declarationFile}#${exportName}`);
      }
    }
    for (const exportName of blocked) {
      if (hasExportedDeclaration(source, exportName)) {
        throw validationError(`Unexpected public type export for removed API: ${declarationFile}#${exportName}`);
      }
    }
    console.log(`[release-validation] type exports ok: ${declarationFile}`);
  }
}

export async function main() {
  log("checking architecture quality gate");
  run(npm, ["run", "validate:architecture"]);

  log("checking required Markdown source files");
  await validatePackageMarkdownFiles();

  log("checking single-file ESLint plugin implementations");
  await validateArchitecturePluginSingleImplementation();

  log("building package for release validation (direct npm pack uses prepack)");
  run(npm, ["run", "build"]);

  log("checking npm pack dry-run contents without duplicating the prepack build");
  const pack = run(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { capture: true });
  if (pack.stderr) console.error(pack.stderr.trimEnd());
  validatePackContents(parsePackJson(pack.stdout));

  log("smoke-testing package imports");
  await validateImports();

  log("checking public type exports");
  await validateTypeExports();

  log("release validation passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
