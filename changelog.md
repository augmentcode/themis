# Changelog

## 0.0.4 - 2026-07-13

- Added shared selector output caching with weak-object and primitive-key support.
- Integrated cached selector outputs across Svelte readable selectors, React signal selectors, and Streaming Kefir selectors while preserving direct selector output behavior.
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