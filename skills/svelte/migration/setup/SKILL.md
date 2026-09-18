---
name: svelte/migration/setup
description: >-
  Prepare an existing Svelte app for incremental migration with an empty
  app-owned reducer map. Route installation, imports, and Store lifecycle to
  their canonical owners, then add each migrated slice registration.
type: sub-skill
requires:
  - svelte
  - svelte/store
  - svelte/component-integration
  - svelte/migration
  - core/import-boundaries
triggers:
  - Svelte migration bootstrap
  - Svelte migration reducer registration
  - Svelte migration saga registration
---
# Migration — Setup (Pre-Migration Bootstrap)

> Complete this once, before migrating an individual slice in `../SKILL.md` → **Recommended Order**.

## Step 1 — Install Dependencies

Use `../../../setup/SKILL.md` → **Installation workflow** for package/peer
installation and explicit skill installation. Select the Svelte bundle for this
existing app; do not repeat greenfield first-slice creation during migration.
That canonical setup owner links the installation, refresh/collision, cleanup,
rollback/uninstall ordering, and maintainer workflow in
`@augmentcode/themis/docs/INSTALLATION.md`.

## Step 2 — Import the Package Runtime

Use the npm package directly; do not copy package sources into the app. Replace
flat package-root, removed utilities-barrel, and source-shaped deep imports using
`../../../core/import-boundaries/SKILL.md` → **Setup — the package export surface**.
Utility exports are explicit leaf subpaths, not wildcard domains. For Svelte
Store imports use `../../store/SKILL.md` → **Correct import and class choice**.

The package publishes compiled ESM files and TypeScript declarations from `dist/`, so application code should keep only app-specific store setup and slice files under `src/lib/store/`.

## Step 3 — Create the Store and Bootstrap It

Create a single `Store` instance at module scope, add reducers to the
constructor map, and register sagas as slices are migrated:

```typescript
// src/lib/store/store.ts
import { Store } from "@augmentcode/themis/svelte-store";
import type { StoreState } from "@augmentcode/themis/types";

export const store = new Store({
  // counter: counterReducer,
});
export type AppState = StoreState<typeof store>;
```

For state inference, reserved internals, initialization, and disposal, follow
`../../store/SKILL.md` → **Lifecycle rules**. Apply
`../../component-integration/SKILL.md` → **Root layout wiring** to this configured
Store. App sagas start explicitly, not automatically on `init()`; component
mount/remount and imperative cancellation rules live in `../../store/SKILL.md` →
**App saga lifetime**. Do not copy a second lifecycle implementation here.

## Step 4 — Start With Empty Registrations

Start with an empty app-owned reducer map and no app sagas. Add one reducer-map
entry per migrated slice, plus explicit startup if it has a saga. Package-owned
internals remain managed by Store; see `../../store/SKILL.md` → **Lifecycle rules**.

## After Setup

Return to `../SKILL.md` → **Recommended Order** for the per-slice sequence, starting
with the simplest isolated shared/domain store. Create slice/selectors/types and
any needed saga using `../../../core/file-structure/SKILL.md` → **Setup — slice directory layout**;
then add the reducer and explicitly start its saga under the selected lifetime.

## Setup Examples

### Add each migrated slice through the reducer map

```typescript
import { Store } from "@augmentcode/themis/svelte-store";
import type { StoreState } from "@augmentcode/themis/types";
import { counterReducer } from "$lib/store/slices/counter/counter-slice";

export const store = new Store({ counter: counterReducer });

export type AppState = StoreState<typeof store>;
```

Layout startup/cleanup examples are in `../../component-integration/SKILL.md` →
**Root layout wiring**; service/test startup and cancellation examples are in
`../../store/SKILL.md` → **App saga lifetime**. Keep init-before-run and reserved-name
checks in that owner rather than duplicating lifecycle examples in the migration adapter.

### 5. Prove empty bootstrap has app reducers only

```typescript
import { Store } from "@augmentcode/themis/svelte-store";

const store = new Store({});
const appReducers = store.getReducers();

export const emptyBootstrapEvidence = {
  reducerDomainsVisibleToApp: Object.keys(appReducers),
};
```

## Verification cues

- Empty-bootstrap evidence lists no app reducers until a slice is migrated.
- Each migrated reducer/saga has one registration owner; follow
  `../../store/SKILL.md` → **Verification cues** for lifecycle checks and
  `../cleanup/SKILL.md` → **Final Checklist Per Slice** before deleting legacy state.

