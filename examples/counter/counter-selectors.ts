/**
 * Counter Selectors — demonstrates selector patterns:
 *
 * - Basic selector: reads a single value from state
 * - Derived selector: computes a value from another selector's `.select()` method
 * - Parameterized selector: accepts an argument for dynamic computation
 *
 * Selectors are created with `createSelector` and support:
 * - `selector()` — in Svelte component init, returns a Svelte readable
 * - `selector.select(state, ...args)` — one-time read (event handlers, tests)
 * - `selector.effect(...args)` — use inside sagas
 */

import { store } from "../store";

/**
 * Basic selector — reads the count value from state.
 * Usage in component: `const count = selectCount();`
 * Usage in saga: `const count = yield* selectCount.effect();`
 */
export const selectCount = store.createSelector((state) => {
  return state.counter.count;
});

/**
 * Derived selector — computes a boolean from another selector's value.
 * Uses `.select(state)` to read the base selector within the selector function.
 * This keeps selectors composable without duplicating logic.
 */
export const selectIsPositive = store.createSelector((state) => {
  const count = selectCount.select(state);
  return count > 0;
});

/**
 * Parameterized selector — accepts a multiplier argument.
 * The generic parameter `[multiplier: number]` defines the argument types.
 * Usage: `selectCountMultiplied(3)` or `selectCountMultiplied.select(state, 3)`
 */
export const selectCountMultiplied = store.createSelector<[multiplier: number], number>(
  (state, multiplier) => {
    const count = selectCount.select(state);
    return count * multiplier;
  }
);

