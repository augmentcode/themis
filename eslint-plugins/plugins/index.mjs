import { plugin as asyncReducerHandlerPlugin } from "../store/async-reducer-handler/plugin.mjs";
import { plugin as autoForkingChannelHelperPlugin } from "../store/auto-forking-channel-helper/plugin.mjs";
import { plugin as collectionInternalMutationPlugin } from "../store/collection-internal-mutation/plugin.mjs";
import { plugin as collectionStateShapePlugin } from "../store/collection-state-shape/plugin.mjs";
import { plugin as componentLifecycleBoundaryPlugin } from "../svelte/component-lifecycle-boundary/plugin.mjs";
import { plugin as actionTypeShapePlugin } from "../store/action-type-shape/plugin.mjs";
import { plugin as createActionOwnerPlugin } from "../store/create-action-owner/plugin.mjs";
import { plugin as directLocalStorageUsagePlugin } from "../store/direct-local-storage-usage/plugin.mjs";
import { plugin as directSelectorCallModePlugin } from "../store/direct-selector-call-mode/plugin.mjs";
import { plugin as duplicateActionTypePlugin } from "../store/duplicate-action-type/plugin.mjs";
import { plugin as duplicateSagaNamePlugin } from "../store/duplicate-saga-name/plugin.mjs";
import { plugin as duplicateSagaRegistrationPlugin } from "../store/duplicate-saga-registration/plugin.mjs";
import { plugin as duplicateSelectorExportPlugin } from "../store/duplicate-selector-export/plugin.mjs";
import { plugin as duplicateSelectorImplementationPlugin } from "../store/duplicate-selector-implementation/plugin.mjs";
import { plugin as duplicateStateFieldPlugin } from "../store/duplicate-state-field/plugin.mjs";
import { plugin as forbiddenComponentImportPlugin } from "../svelte/forbidden-component-import/plugin.mjs";
import { plugin as forbiddenReduxApiPlugin } from "../core/forbidden-redux-api/plugin.mjs";
import { plugin as inlineSagaSelectorPlugin } from "../store/inline-saga-selector/plugin.mjs";
import { plugin as nonSerializableInitialStatePlugin } from "../store/non-serializable-initial-state/plugin.mjs";
import { plugin as nonSerializableStateTypePlugin } from "../store/non-serializable-state-type/plugin.mjs";
import { plugin as nondeterministicReducerStatePlugin } from "../store/nondeterministic-reducer-state/plugin.mjs";
import { plugin as passThroughWrapperPlugin } from "../core/pass-through-wrapper/plugin.mjs";
import { plugin as rawChannelCleanupPlugin } from "../store/raw-channel-cleanup/plugin.mjs";
import { plugin as reactComponentLifecycleBoundaryPlugin } from "../react/react-component-lifecycle-boundary/plugin.mjs";
import { plugin as reactForbiddenComponentImportPlugin } from "../react/react-forbidden-component-import/plugin.mjs";
import { plugin as reactPreferDirectSelectorPlugin } from "../react/react-prefer-direct-selector/plugin.mjs";
import { plugin as reducerSideEffectPlugin } from "../store/reducer-side-effect/plugin.mjs";
import { plugin as removedMiddlewareSourcePlugin } from "../core/removed-middleware-source/plugin.mjs";
import { plugin as sagaWatcherActionTypePlugin } from "../store/saga-watcher-action-type/plugin.mjs";
import { plugin as selectorExportNamePlugin } from "../store/selector-export-name/plugin.mjs";
import { plugin as selectorFileNamePlugin } from "../store/selector-file-name/plugin.mjs";
import { plugin as sharedReactStoreBoundaryPlugin } from "../react/shared-react-store-boundary/plugin.mjs";
import { plugin as sharedSvelteStoreBoundaryPlugin } from "../svelte/shared-svelte-store-boundary/plugin.mjs";
import { plugin as sourceShapedPackageImportPlugin } from "../core/source-shaped-package-import/plugin.mjs";
import { plugin as stateTypeNamePlugin } from "../store/state-type-name/plugin.mjs";
import { plugin as storeConstructorSagaMapPlugin } from "../store/store-constructor-saga-map/plugin.mjs";
import { plugin as suspiciousStateFieldPlugin } from "../store/suspicious-state-field/plugin.mjs";
import { plugin as testSelectorSelectPlugin } from "../store/test-selector-select/plugin.mjs";
import { plugin as typedSagaCallMockGuardPlugin } from "../store/typed-saga-call-mock-guard/plugin.mjs";
import { plugin as typedSagaYieldStarPlugin } from "../store/typed-saga-yield-star/plugin.mjs";
import { plugin as unnamespacedActionTypePlugin } from "../store/unnamespaced-action-type/plugin.mjs";
import { plugin as waitForNamedSelectorPlugin } from "../store/wait-for-named-selector/plugin.mjs";

export {
  actionTypeShapePlugin,
  asyncReducerHandlerPlugin,
  autoForkingChannelHelperPlugin,
  collectionInternalMutationPlugin,
  collectionStateShapePlugin,
  componentLifecycleBoundaryPlugin,
  createActionOwnerPlugin,
  directLocalStorageUsagePlugin,
  directSelectorCallModePlugin,
  duplicateActionTypePlugin,
  duplicateSagaNamePlugin,
  duplicateSagaRegistrationPlugin,
  duplicateSelectorExportPlugin,
  duplicateSelectorImplementationPlugin,
  duplicateStateFieldPlugin,
  forbiddenComponentImportPlugin,
  forbiddenReduxApiPlugin,
  inlineSagaSelectorPlugin,
  nonSerializableInitialStatePlugin,
  nonSerializableStateTypePlugin,
  nondeterministicReducerStatePlugin,
  passThroughWrapperPlugin,
  rawChannelCleanupPlugin,
  reactComponentLifecycleBoundaryPlugin,
  reactForbiddenComponentImportPlugin,
  reactPreferDirectSelectorPlugin,
  reducerSideEffectPlugin,
  removedMiddlewareSourcePlugin,
  sagaWatcherActionTypePlugin,
  selectorExportNamePlugin,
  selectorFileNamePlugin,
  sharedReactStoreBoundaryPlugin,
  sharedSvelteStoreBoundaryPlugin,
  sourceShapedPackageImportPlugin,
  stateTypeNamePlugin,
  storeConstructorSagaMapPlugin,
  suspiciousStateFieldPlugin,
  testSelectorSelectPlugin,
  typedSagaCallMockGuardPlugin,
  typedSagaYieldStarPlugin,
  unnamespacedActionTypePlugin,
  waitForNamedSelectorPlugin,
};

export const sourceBoundaryRulePlugins = {
  "forbidden-component-import": forbiddenComponentImportPlugin,
  "component-lifecycle-boundary": componentLifecycleBoundaryPlugin,
  "source-shaped-package-import": sourceShapedPackageImportPlugin,
  "pass-through-wrapper": passThroughWrapperPlugin,
  "selector-file-name": selectorFileNamePlugin,
  "selector-export-name": selectorExportNamePlugin,
  "removed-middleware-source": removedMiddlewareSourcePlugin,
  "shared-svelte-store-boundary": sharedSvelteStoreBoundaryPlugin,
};

export const nativeReplacementRulePlugins = {
  "forbidden-component-import": forbiddenComponentImportPlugin,
  "source-shaped-package-import": sourceShapedPackageImportPlugin,
  "forbidden-redux-api": forbiddenReduxApiPlugin,
  "state-type-name": stateTypeNamePlugin,
  "unnamespaced-action-type": unnamespacedActionTypePlugin,
  "action-type-shape": actionTypeShapePlugin,
  "create-action-owner": createActionOwnerPlugin,
  "direct-local-storage-usage": directLocalStorageUsagePlugin,
  "selector-file-name": selectorFileNamePlugin,
  "selector-export-name": selectorExportNamePlugin,
  "removed-middleware-source": removedMiddlewareSourcePlugin,
  "shared-svelte-store-boundary": sharedSvelteStoreBoundaryPlugin,
};

export const aggregateCheckRulePlugins = {
  "duplicate-action-type": duplicateActionTypePlugin,
  "duplicate-selector-export": duplicateSelectorExportPlugin,
  "duplicate-selector-implementation": duplicateSelectorImplementationPlugin,
  "duplicate-saga-name": duplicateSagaNamePlugin,
  "duplicate-saga-registration": duplicateSagaRegistrationPlugin,
  "suspicious-state-field": suspiciousStateFieldPlugin,
  "duplicate-state-field": duplicateStateFieldPlugin,
};

export const stateCollectionReducerRulePlugins = {
  "non-serializable-state-type": nonSerializableStateTypePlugin,
  "non-serializable-initial-state": nonSerializableInitialStatePlugin,
  "nondeterministic-reducer-state": nondeterministicReducerStatePlugin,
  "collection-state-shape": collectionStateShapePlugin,
  "collection-internal-mutation": collectionInternalMutationPlugin,
  "reducer-side-effect": reducerSideEffectPlugin,
  "async-reducer-handler": asyncReducerHandlerPlugin,
};

export const sagaSelectorChannelRulePlugins = {
  "saga-watcher-action-type": sagaWatcherActionTypePlugin,
  "inline-saga-selector": inlineSagaSelectorPlugin,
  "direct-selector-call-mode": directSelectorCallModePlugin,
  "wait-for-named-selector": waitForNamedSelectorPlugin,
  "typed-saga-yield-star": typedSagaYieldStarPlugin,
  "auto-forking-channel-helper": autoForkingChannelHelperPlugin,
  "raw-channel-cleanup": rawChannelCleanupPlugin,
  "store-constructor-saga-map": storeConstructorSagaMapPlugin,
};

export const testPatternRulePlugins = {
  "test-selector-select": testSelectorSelectPlugin,
  "typed-saga-call-mock-guard": typedSagaCallMockGuardPlugin,
};

export const coreRulePlugins = {
  "source-shaped-package-import": sourceShapedPackageImportPlugin,
  "forbidden-redux-api": forbiddenReduxApiPlugin,
  "pass-through-wrapper": passThroughWrapperPlugin,
  "removed-middleware-source": removedMiddlewareSourcePlugin,
};

export const storeRulePlugins = {
  "duplicate-action-type": duplicateActionTypePlugin,
  "duplicate-selector-export": duplicateSelectorExportPlugin,
  "duplicate-selector-implementation": duplicateSelectorImplementationPlugin,
  "suspicious-state-field": suspiciousStateFieldPlugin,
  "duplicate-state-field": duplicateStateFieldPlugin,
  "non-serializable-state-type": nonSerializableStateTypePlugin,
  "non-serializable-initial-state": nonSerializableInitialStatePlugin,
  "nondeterministic-reducer-state": nondeterministicReducerStatePlugin,
  "collection-state-shape": collectionStateShapePlugin,
  "collection-internal-mutation": collectionInternalMutationPlugin,
  "reducer-side-effect": reducerSideEffectPlugin,
  "async-reducer-handler": asyncReducerHandlerPlugin,
  "state-type-name": stateTypeNamePlugin,
  "unnamespaced-action-type": unnamespacedActionTypePlugin,
  "action-type-shape": actionTypeShapePlugin,
  "create-action-owner": createActionOwnerPlugin,
  "selector-file-name": selectorFileNamePlugin,
  "selector-export-name": selectorExportNamePlugin,
  "direct-selector-call-mode": directSelectorCallModePlugin,
  "test-selector-select": testSelectorSelectPlugin,
  "duplicate-saga-name": duplicateSagaNamePlugin,
  "duplicate-saga-registration": duplicateSagaRegistrationPlugin,
  "saga-watcher-action-type": sagaWatcherActionTypePlugin,
  "inline-saga-selector": inlineSagaSelectorPlugin,
  "wait-for-named-selector": waitForNamedSelectorPlugin,
  "typed-saga-yield-star": typedSagaYieldStarPlugin,
  "auto-forking-channel-helper": autoForkingChannelHelperPlugin,
  "raw-channel-cleanup": rawChannelCleanupPlugin,
  "store-constructor-saga-map": storeConstructorSagaMapPlugin,
  "direct-local-storage-usage": directLocalStorageUsagePlugin,
  "typed-saga-call-mock-guard": typedSagaCallMockGuardPlugin,
};

export const svelteRulePlugins = {
  "forbidden-component-import": forbiddenComponentImportPlugin,
  "component-lifecycle-boundary": componentLifecycleBoundaryPlugin,
  "shared-svelte-store-boundary": sharedSvelteStoreBoundaryPlugin,
};

export const reactRulePlugins = {
  "react-forbidden-component-import": reactForbiddenComponentImportPlugin,
  "react-component-lifecycle-boundary": reactComponentLifecycleBoundaryPlugin,
  "react-prefer-direct-selector": reactPreferDirectSelectorPlugin,
  "shared-react-store-boundary": sharedReactStoreBoundaryPlugin,
};

export const architectureSourceRulePlugins = {
  ...aggregateCheckRulePlugins,
  ...sourceBoundaryRulePlugins,
  ...nativeReplacementRulePlugins,
  ...stateCollectionReducerRulePlugins,
  ...sagaSelectorChannelRulePlugins,
};

export const architectureRulePlugins = {
  ...architectureSourceRulePlugins,
  ...reactRulePlugins,
  ...testPatternRulePlugins,
};

export const architectureRules = Object.fromEntries(
  Object.entries(architectureRulePlugins).map(([ruleId, plugin]) => [ruleId, plugin.rules[ruleId]])
);