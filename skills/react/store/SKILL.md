---
name: react/store
description: >-
  ReactStore import, initialization, disposal, and Store-runtime guidance for the
  React signal Store variant. Use for @augmentcode/themis/react-store,
  getSignalState(), inherited runSaga/dispatch/state behavior, and contrast with
  Svelte-readable Store or StreamingStore without teaching those call modes.
type: sub-skill
requires:
  - react
  - core/import-boundaries
sources:
  - "@augmentcode/themis/react-store"
  - augmentcode/themis:docs/ARCHITECTURE.md
  - augmentcode/themis:README.md
triggers:
  - ReactStore
  - react-store import
  - getSignalState
  - signal Store
---
# ReactStore import and lifecycle

Use this skill when a task needs the React signal Store variant. For shared statepolicy, reducers, actions, sagas, and package import boundaries, also follow thematching `core/*` skills.

## Correct import and class choice

- Use `ReactStore` from `@augmentcode/themis/react-store`.
- Use `Store` from `@augmentcode/themis/svelte-store` only for a separate Svelte appwhose direct selector calls should return Svelte readables.
- Use `StreamingStore` from `@augmentcode/themis/streaming-store` only for a separatestream/Node path whose direct selector calls should return Kefir observables.
- Do not import React selector internals from `src/*` or `utils/react-selectors/*`.

```ts
import { ReactStore } from "@augmentcode/themis/react-store";

export const reactStore = new ReactStore({ todos: todosReducer });
const dispose = reactStore.init();
```

## Lifecycle rules

- Construct `ReactStore` with app-owned reducers and optional middleware, then call`reactStore.init(initialState?)` before invoking direct selector calls,`.useValue(...args)`, or `reactStore.getSignalState()`.
- `getSignalState()` returns the Store state as a Preact React signal afterinitialization and throws before `init()` or after `dispose()`.
- `reactStore.dispatch`, `reactStore.state`, `reactStore.runSaga(sagaFn)`, and`reactStore.dispose()` follow the shared Store runtime behavior documented incore Store guidance.
- Do not manually register package-owned `@internal_` reducers or internal sagas.

## Verification cues

- Imports use `@augmentcode/themis/react-store` for `ReactStore`.
- React examples initialize the Store before signal selector reads.
- The app path does not mix Svelte readable or Kefir observable Store setup.