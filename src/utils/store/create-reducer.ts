import { type UnknownAction } from "redux";
import { shallowEqual } from "fast-equals";
import { type StoreAction, type StoreActionCreator } from "../../types";

export type StoreReducer<S, A> = (state: S, action: A) => S;

export const createReducer = <S, A extends StoreAction<any> = StoreAction<any>>(
  initialState: S
) => {
  const handlers: Record<string, StoreReducer<S, A>> = {};

  const withReducer = <ARGS extends any[], PL = ARGS>(
    action: StoreActionCreator<ARGS, PL>,
    reducer: StoreReducer<S, StoreAction<PL>>
  ) => {
    handlers[action.type] = reducer;
    return storeReducer;
  };

  const storeReducer = (
    state: S | undefined = initialState,
    action: StoreAction<any> | UnknownAction
  ) => {
    const handler = handlers[action.type];
    const nextState = handler?.(state, action as A) ?? state;
    return shallowEqual(nextState, state) ? state : nextState;
  };

  storeReducer.with = withReducer;
  storeReducer.initialState = initialState;

  return storeReducer;
};

