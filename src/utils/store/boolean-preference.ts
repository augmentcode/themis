import { createAction } from "./create-action";
import type { BooleanPreferenceReducerBuilder } from "../types";

export type { BooleanPreferenceReducerBuilder } from "../types";

type BooleanFieldKey<S> = {
  [K in keyof S]-?: S[K] extends boolean ? K : never;
}[keyof S] & string;

type CreateBooleanPreferenceOptions<
  S,
  Field extends BooleanFieldKey<S> = BooleanFieldKey<S>,
> = {
  sliceName: string;
  field: Field;
  setActionName: string;
  toggleActionName: string;
};

export function createBooleanPreference<
  S,
  Field extends BooleanFieldKey<S> = BooleanFieldKey<S>,
>({
  sliceName,
  field,
  setActionName,
  toggleActionName,
}: CreateBooleanPreferenceOptions<S, Field>) {
  // eslint-disable-next-line architecture/create-action-owner -- helper factory creates caller-owned preference actions.
  const setAction = createAction<[value: boolean]>(`${sliceName}/${setActionName}`);
  // eslint-disable-next-line architecture/create-action-owner -- helper factory creates caller-owned preference actions.
  const toggleAction = createAction(`${sliceName}/${toggleActionName}`);

  const updateField = (state: S, value: boolean): S => ({
    ...state,
    [field]: value,
  }) as S;

  return {
    setAction,
    toggleAction,
    register(builder: BooleanPreferenceReducerBuilder<S>): BooleanPreferenceReducerBuilder<S> {
      return builder
        .with(setAction, (state, { payload: [value] }) => updateField(state, value))
        .with(toggleAction, (state) => updateField(state, !state[field]));
    },
  };
}

