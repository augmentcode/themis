# Changelog

## 0.2.7 - 2026-09-09

- Cleared inactive selector output caches after the final consumer unsubscribes across Svelte, React, and Streaming selectors, with cleanup centralized in `getOrCreate`.
- Prevented inactive outputs from retaining historical Redux snapshots; see https://github.com/intent-hq/intent/issues/4596#issuecomment-5592920634.

## 0.2.5 - 2026-08-31

- Bumped package metadata for the 0.2.5 patch release.
- PR #16 by Clement Pang: Improved selector performance by caching tracking proxies and building path keys incrementally.

## 0.2.4 - 2026-08-19

- Refactored logging and selector-tracing streams, including custom logger lifecycle handling and expanded tracing contracts and tests.
- Normalized skill and documentation links and strengthened release validation coverage.

## 0.2.2 - 2026-08-19

- Added Redux action and state logging with shared diagnostic streams and public logging types.
- Expanded tracing documentation, packaged skills, and release validation coverage.

## 0.2.1 - 2026-08-17

- Enabled explicitly configured selector tracing in production builds.

## 0.2.0 - 2026-08-17

- Added selector-tracing diagnostics with configurable trace categories, cache and invalidation metrics, result metrics, and privacy-safe summaries.
- Added supporting tracing tests and documentation.

## 0.1.4

- Normalize documentation links and validate package metadata for the release.

## 0.1.3 - 2026-08-10

- Isolated React, Svelte, and Streaming skill guidance, decoupled shared runtime imports from UI frameworks, and added regression coverage for the boundary.
- Added safe Claude-compatible skill linking alongside the canonical `.agents/skills/themis` install tree and clarified package/skill installation workflows.

## 0.1.2 - 2026-08-10

- Fixed selector notifications so Svelte readables and shared Kefir-backed selector outputs suppress unchanged primitive and shallow-equal values.
- Evicted Store-scoped selector output caches during disposal, preserving isolation between Store instances and creating fresh Svelte, React, and Streaming outputs after re-initialization.
- Expanded lifecycle, cache invalidation, and event-driven cadence coverage for explicit tick requests, coalescing, rate limiting, listener cleanup, disposal, and idle timer behavior.

## 0.1.1 - 2026-07-14

- Fixed selector cadence to be event-driven so selector updates are requested by Redux store changes instead of ticking continuously while idle.
- Added regression coverage for idle selector subscriptions and throttled/coalesced updates across store and React store behavior.

## 0.1.0 - 2026-07-14

- Simplified scheduled selector throttling around store-owned cadence streams and local selector coalescing.
- Removed obsolete selector flush, scheduler, cached-selector, and cadence getter internals from runtime/store APIs.
- Updated selector runtime initialization and store type usage to rely on direct Store APIs.
- Moved Kefir into runtime dependencies to match StoreRuntime's direct Kefir cadence stream usage.
- Cleaned up packaged skills and docs guidance for the removed observable state APIs and selector cleanup.

## 0.0.4 - 2026-07-13

- Added shared selector output caching with weak-object and primitive-key support.
- Integrated cached selector outputs across Svelte readable selectors, React signal selectors, and Streaming Kefir selectors while preserving direct selector output behavior.
- Renamed observable Store-family state accessor functions to `getStateObservable`.
- Added cross-family selector-channel support so saga helpers accept Svelte, React, and Streaming selector objects without casts.
- Added and updated selector output caching tests, selector-channel tests, Svelte explicit store binding coverage, React selector coverage, and Streaming selector coverage.
- Fixed validation blockers for package self-reference imports and Svelte selector store detection.
- Updated selector, waitFor, selector-channel, and observable skill/docs guidance, including a local skillsUpdate maintenance skill.

## 0.0.3 - 2026-07-04

- Expanded React selector guidance in packaged skills and documentation.
- Improved the React direct selector ESLint rule and its validation coverage.
- Updated package validation tests for the React selector rule changes.

## 0.0.2 - 2026-07-02

- Added an ESLint rule that prevents saga-local selectors.
- Added three additional ESLint rules and expanded supported file-type coverage for architecture validation.
- Updated package and architecture validation tests for the new lint rules.

## 0.0.1 - 2026-06-22

- Initial package release for Themis.
- Added Svelte, React, and Streaming store implementations with selector, saga, collection, and runtime utilities.
- Added documentation for installation, architecture, reducers, selectors, sagas, collections, waitFor, and testing.
- Added packaged skills, examples, lifecycle scripts, package validation, architecture validation, and ESLint plugins.