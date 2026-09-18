---
name: svelte/component-integration
description: >-
  Wire a configured Store into Svelte root layouts, templates, and handlers.
  Apply svelte/store lifecycle contracts and svelte/selector-lifecycle call
  modes; this leaf owns component wiring, not Store API or selector policy.
type: sub-skill
library: themis
requires:
  - svelte
  - svelte/store
  - svelte/selector-lifecycle
sources:
  - "@augmentcode/themis/svelte-store"
  - ../store/SKILL.md
  - ../selector-lifecycle/SKILL.md
triggers:
  - Svelte layout wiring
  - Svelte component wiring
  - Svelte $selector$ template
---
# Component Integration — Store-first setup and dispatch

> Wire the Store class into a Svelte 5 app. Bootstrap in the root layout with `store.init()` + `onDestroy`, bind selector readables in templates as `$selectorResult$`, and dispatch/read one-shot state through the initialized app `Store` instance.

This is Svelte Store family guidance for Svelte component initialization,
readable selector binding, and Store dispatch.

## Store contract handoff

Before wiring a layout, read `../store/SKILL.md` → **Correct import and class choice**,
**Lifecycle rules**, **App saga lifetime**, and **Svelte component lifecycle helpers**.
That owner covers constructor maps, state inference, middleware ordering, internal
domains, init/dispose, devtools registration, and saga cancellation. Selector
factory contracts live in `../selectors/SKILL.md` → **Choose the factory**.

## Root layout wiring

Create a single `Store` instance with app-owned reducers at module scope:

```typescript
// src/lib/store/store.ts
import { Store } from "@augmentcode/themis/svelte-store";
import type { StoreState } from "@augmentcode/themis/types";
import { counterReducer } from "./slices/counter/counter-slice";

export const store = new Store({ counter: counterReducer });
export type AppState = StoreState<typeof store>;
```

Bootstrap in `+layout.svelte` by initializing the configured Store instance and registering its disposer:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { store } from "$lib/store/store";
  import { counterSaga } from "$lib/store/slices/counter/sagas/counter-saga";

  const dispose = store.init();
  onDestroy(dispose);
  onMount(() => store.runSaga(counterSaga));
</script>

{@render children()}
```

Initialize before children render, pass preloaded state to `init(initialState)` if
needed, and keep teardown next to initialization. The saga above is mount-scoped,
not once-per-Store: see `../store/SKILL.md` → **App saga lifetime** for remount,
imperative cancellation, and whole-Store teardown semantics.

## Template and handler wiring

At the top of a component script block (component init), create selector readables and import the configured Store for event-handler dispatch/state reads:

```svelte
<script lang="ts">
  import { store } from "$lib/store";
  import { selectItems, selectIsLoading } from "./slices/my-slice/my-slice-selectors";
  import { fetchItems, removeItem } from "./slices/my-slice/my-slice-slice";

  // ✅ At component init — selector readable calls use getContext() internally.
  const items$     = selectItems();
  const isLoading$ = selectIsLoading();

  // ✅ Event handler — use .select() with the imported app Store instance.
  function handleDelete(id: string) {
    const currentItems = selectItems.select(store.state);
    if (currentItems.length > 1) {
      store.dispatch(removeItem(id));
    }
  }
</script>

{#if $isLoading$}
  <Loading />
{:else}
  {#each $items$ as item}
    <ItemRow {item} onDelete={() => handleDelete(item.id)} />
  {/each}
{/if}
```

Capture readables in the script and render `$selectorResult$` in the template;
handlers dispatch through the configured Store. For the complete component,
callback/async, test, saga, composition, and explicit-binding matrix, use
`../selector-lifecycle/SKILL.md` → **Call-mode map** and **Don't**. That owner also
covers one-shot service reads and the prohibition on standalone dispatch helpers.

## Wiring pitfalls

### Missing cleanup or duplicate initialization

Keep one root owner and its cleanup together. Missing cleanup leaks runtime
subscriptions/tasks; adding child initialization is not a fix for missing state.
Use `../store/SKILL.md` → **Lifecycle rules** for disposal and noop-init behavior.

### Creating a wrapper hook around `dispatch`

**Mechanism:** the package convention is to dispatch action creators directly. Wrappers obscure the action flow and break test plans that assert `put(action)`.

```typescript
// ❌ WRONG
export function useAddItem() {
  return (i: Item) => store.dispatch(addItem(i));
}

// ✅ CORRECT
// in the component:
store.dispatch(addItem(i));
```

*Canonical import/dispatch boundaries: `../../core/import-boundaries/SKILL.md` → **Core Patterns**.*

### Reading state with `selector()` in a template

This violates the component-init/context contract, not a cache-miss guarantee.
Identical Store + selector + arguments reuse the readable; see
`../selectors/SKILL.md` → **Selector caching** and
`../selector-lifecycle/SKILL.md` → **Pitfalls**. Render the captured `$count$`,
not `selectCount()` in markup.

## See also

- `../store/SKILL.md` — Store API and lifecycle contracts.
- `../selector-lifecycle/SKILL.md` — selector call-site rules.
- `../../core/file-structure/SKILL.md` — slice layout and registration order.
- `../../setup/SKILL.md` — first-time greenfield setup.
