/**
 * Counter Slice — demonstrates basic Redux patterns:
 *
 * - `createAction` for defining typed actions (with and without payloads)
 * - `createReducer` with `.with()` case handlers for immutable state updates
 * - Clean initial state type definition
 *
 * This is the simplest possible slice — a good starting point for new features.
 */

import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

// --- State type ---

export type CounterState = {
  count: number;
};

const initialState: CounterState = {
  count: 0,
};

// --- Actions ---
// Actions use the "sliceName/actionName" namespace convention.
// No-payload actions use createAction(type).
// Actions with data use createAction<[argTypes]>(type).

/** Increment the counter by 1 */
export const increment = createAction("counter/increment");

/** Decrement the counter by 1 */
export const decrement = createAction("counter/decrement");

/** Reset the counter to 0 */
export const reset = createAction("counter/reset");

/** Increment the counter by a specific amount */
export const incrementBy = createAction<[amount: number]>("counter/incrementBy");

// --- Reducer ---
// createReducer returns a reducer with `.with(action, handler)` for each case.
// Each handler receives the current state and returns a new state (immutable).

export const counterReducer = createReducer<CounterState>(initialState);

counterReducer.with(increment, (state) => ({
    ...state,
    count: state.count + 1,
  }));
counterReducer.with(decrement, (state) => ({
    ...state,
    count: state.count - 1,
  }));
counterReducer.with(reset, () => initialState);
counterReducer.with(incrementBy, (state, action) => ({
    ...state,
    count: state.count + action.payload[0],
  }));

