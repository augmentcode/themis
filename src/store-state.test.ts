import { describe, expect, it } from 'vitest';
import type { Store as ReduxStore, UnknownAction } from 'redux';
import type { Readable } from 'svelte/store';
import type { Observable as KefirObservable } from 'kefir';
import type { ReadonlySignal } from '@preact/signals-react';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { StoreInstanceState, StoreOptions, StoreState } from '@augmentcode/themis/types';
import { Store } from './svelte-store';
import { StreamingStore } from './streaming-store';
import { ReactStore } from './react-store';
import { createSelector } from './utils/svelte-selectors/create-selector';
import { createSelector as createReactSelector } from './utils/react-selectors/create-selector';
import { INTERNAL_SAGA_MANAGER_NAME, INTERNAL_STORE_UTILITY_DOMAIN } from './constants';
import type { SagaCrashState } from './slices/saga-manager/saga-manager-slice';
import { storeUtilityReducer } from './slices/store-utility/store-utility-slice';
import type { StoreUtilityState } from './slices/store-utility/store-utility-slice';

type Assert<T extends true> = T;
type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;

type CounterState = { value: number };
type TodosState = { items: string[] };
const counterReducer = (state: CounterState = { value: 0 }) => state;
const counterSaga = function* () {};
const reducerObjectCounterReducer = createReducer<CounterState>({ value: 0 });
const reducerObjectTodosReducer = createReducer<TodosState>({ items: [] });

const createStoreWithCounter = () => new Store({ counter: counterReducer });
const fractionalSelectorOptions: StoreOptions = { throttledSelectorFrequency: 12.5 };

describe('StoreState inference', () => {
  it('keeps StoreState usable as a broad state type by default', () => {
    const state: StoreState = { anyDomain: { value: 'allowed' } };
    expect(state.anyDomain.value).toBe('allowed');
  });
});

type _BroadStoreInstanceStateStaysBroad = Assert<IsEqual<StoreInstanceState, Record<string, any>>>;

const freshStore = new Store();
type FreshStoreState = StoreState<typeof freshStore>;
type FreshStoreInternalState = FreshStoreState[typeof INTERNAL_STORE_UTILITY_DOMAIN];
type _FreshStoreIncludesInternalState = Assert<IsEqual<FreshStoreInternalState, StoreUtilityState>>;

const selectFreshUpdatesLocked = freshStore.createSelector((state) => {
  type _FreshSelectorStateIsStoreState = Assert<IsEqual<typeof state, StoreState<typeof freshStore>>>;
  const updatesLocked: boolean = state[INTERNAL_STORE_UTILITY_DOMAIN].updatesLocked;
  // @ts-expect-error fresh Store selectors should not expose app reducer domains.
  state.counter;
  return updatesLocked;
});

const storeWithCounter = createStoreWithCounter();
type StoreWithCounterState = StoreState<typeof storeWithCounter>;
type StoreWithCounterInstanceState = StoreInstanceState<typeof storeWithCounter>;
type ExpectedStoreWithCounterState = {
  [INTERNAL_STORE_UTILITY_DOMAIN]: StoreUtilityState;
  [INTERNAL_SAGA_MANAGER_NAME]: SagaCrashState;
  counter: CounterState;
};
type _StoreWithCounterStateIsCleanDomainState = Assert<IsEqual<StoreWithCounterState, ExpectedStoreWithCounterState>>;
type _StoreInstanceStateAliasPreservesCounterState = Assert<IsEqual<StoreWithCounterInstanceState, StoreWithCounterState>>;
type _StoreWithCounterIncludesCounterState = Assert<IsEqual<StoreWithCounterState['counter'], CounterState>>;
type _StoreWithCounterIncludesInternalState = Assert<
  IsEqual<StoreWithCounterState[typeof INTERNAL_STORE_UTILITY_DOMAIN], StoreUtilityState>
>;
const streamingStoreWithCounter = new StreamingStore({ counter: counterReducer });
const reactStoreWithCounter = new ReactStore({ counter: counterReducer });
const storeWithSelectorOptions = new Store({ counter: counterReducer }, undefined, fractionalSelectorOptions);
const streamingStoreWithSelectorOptions = new StreamingStore({ counter: counterReducer }, undefined, fractionalSelectorOptions);
const reactStoreWithSelectorOptions = new ReactStore({ counter: counterReducer }, undefined, fractionalSelectorOptions);
type _StreamingStoreStateMatchesStore = Assert<IsEqual<StoreState<typeof streamingStoreWithCounter>, ExpectedStoreWithCounterState>>;
type _ReactStoreStateMatchesStore = Assert<IsEqual<StoreState<typeof reactStoreWithCounter>, ExpectedStoreWithCounterState>>;
type StoreWithCounterStateGetter = typeof storeWithCounter.state;
type _StoreStateGetterPreservesCounterState = Assert<IsEqual<StoreWithCounterStateGetter, StoreWithCounterState>>;
type StoreWithCounterReadableState = ReturnType<typeof storeWithCounter.getReadableState>;
type _StoreReadableStatePreservesCounterState = Assert<IsEqual<StoreWithCounterReadableState, Readable<StoreWithCounterState>>>;
type StreamingStoreStreamState = ReturnType<typeof streamingStoreWithCounter.getStreamState>;
type _StreamingStatePreservesCounterState = Assert<IsEqual<StreamingStoreStreamState, KefirObservable<ExpectedStoreWithCounterState, any>>>;
type ReactStoreSignalState = ReturnType<typeof reactStoreWithCounter.getSignalState>;
type _ReactSignalStatePreservesCounterState = Assert<IsEqual<ReactStoreSignalState, ReadonlySignal<ExpectedStoreWithCounterState>>>;
type StoreWithCounterDispatchGetter = typeof storeWithCounter.dispatch;
type _StoreDispatchGetterMatchesReduxDispatch = Assert<IsEqual<StoreWithCounterDispatchGetter, ReduxStore<StoreState, UnknownAction>['dispatch']>>;
if (false) {
  storeWithCounter.runSaga(counterSaga);
  // @ts-expect-error runSaga accepts a saga function, not a saga name string.
  storeWithCounter.runSaga('counterSaga');
  // @ts-expect-error Store no longer exposes public reducer mutators.
  storeWithCounter.addReducer('otherCounter', counterReducer);
  // @ts-expect-error Store no longer exposes public saga mutators.
  storeWithCounter.addSaga('otherSaga', counterSaga);
  // @ts-expect-error Store no longer exposes public saga registration.
  storeWithCounter.registerSagas({ counterSaga });
}

const inferredState: StoreWithCounterState = {
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false },
  [INTERNAL_SAGA_MANAGER_NAME]: {},
  counter: { value: 1 },
};

const wrongCounterState: StoreWithCounterState = {
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false },
  [INTERNAL_SAGA_MANAGER_NAME]: {},
  // @ts-expect-error counter.value must remain a number when inferred from counterReducer.
  counter: { value: 'wrong' },
};

const selectCounterValue = storeWithCounter.createSelector((state, multiplier: number) => {
  type _CounterSelectorStateIsStoreState = Assert<IsEqual<typeof state, StoreState<typeof storeWithCounter>>>;
  type _CounterSelectorStateIsStoreInstanceState = Assert<IsEqual<typeof state, StoreInstanceState<typeof storeWithCounter>>>;
  type _CounterSelectorStateIsCleanDomainState = Assert<IsEqual<typeof state, ExpectedStoreWithCounterState>>;
  const value: number = state.counter.value;
  // @ts-expect-error counter.value is inferred as number, not string.
  const invalidValue: string = state.counter.value;
  // @ts-expect-error selector state exposes reducer return state, not raw reducer functions.
  const rawReducer: typeof counterReducer = state.counter;
  // @ts-expect-error reducer state is a domain state object and should not be callable.
  const callableCounter: (state: CounterState | undefined, action: unknown) => CounterState = state.counter;
  // @ts-expect-error unregistered reducer domains are not available on this Store state.
  state.todos;
  return value * multiplier;
});

const createStreamingCounterValueSelector = () => streamingStoreWithCounter.createSelector((state, multiplier: number) => {
  const value: number = state.counter.value;
  return value * multiplier;
});

const selectReactCounterValue = reactStoreWithCounter.createSelector((state, multiplier: number) => {
  const value: number = state.counter.value;
  return value * multiplier;
});

type StreamingCounterValueSelector = ReturnType<typeof createStreamingCounterValueSelector>;
type _StreamingSelectorReturnsObservable = Assert<IsEqual<ReturnType<StreamingCounterValueSelector>, KefirObservable<number, any>>>;
type _ReactSelectorReturnsSignal = Assert<IsEqual<ReturnType<typeof selectReactCounterValue>, ReadonlySignal<number>>>;
type _ReactSelectorUseReturnsValue = Assert<IsEqual<ReturnType<typeof selectReactCounterValue.useValue>, number>>;

const standaloneSelectCounterValue = createSelector(storeWithCounter, (state, multiplier: number) => {
  type _StandaloneSelectorStateIsStoreState = Assert<IsEqual<typeof state, StoreState<typeof storeWithCounter>>>;
  type _StandaloneSelectorStateIsStoreInstanceState = Assert<IsEqual<typeof state, StoreInstanceState<typeof storeWithCounter>>>;
  const value: number = state.counter.value;
  // @ts-expect-error standalone selector state still rejects unregistered reducer domains.
  state.todos;
  return value * multiplier;
});

const standaloneReactSelectCounterValue = createReactSelector(reactStoreWithCounter, (state, multiplier: number) => {
  const value: number = state.counter.value;
  // @ts-expect-error standalone React selector state still rejects unregistered reducer domains.
  state.todos;
  return value * multiplier;
});
const selectStreamingCounterValue = undefined as unknown as StreamingCounterValueSelector;

const storeWithReducerObjects = new Store({
  counter: reducerObjectCounterReducer,
  todos: reducerObjectTodosReducer,
});
type StoreWithReducerObjectsState = StoreState<typeof storeWithReducerObjects>;
type ExpectedStoreWithReducerObjectsState = {
  [INTERNAL_STORE_UTILITY_DOMAIN]: StoreUtilityState;
  [INTERNAL_SAGA_MANAGER_NAME]: SagaCrashState;
  counter: CounterState;
  todos: TodosState;
};
type _ReducerObjectStoreStateIsCleanDomainState = Assert<
  IsEqual<StoreWithReducerObjectsState, ExpectedStoreWithReducerObjectsState>
>;

const selectReducerObjectDomains = storeWithReducerObjects.createSelector((state) => {
  type _ReducerObjectSelectorStateIsCleanDomainState = Assert<
    IsEqual<typeof state, ExpectedStoreWithReducerObjectsState>
  >;
  const counterState: CounterState = state.counter;
  const todosState: TodosState = state.todos;
  // @ts-expect-error selector state exposes CounterState, not reducer helper members.
  state.counter.with;
  // @ts-expect-error selector state exposes CounterState, not reducer initialState helpers.
  state.counter.initialState;
  // @ts-expect-error selector state exposes TodosState, not a callable reducer object.
  state.todos(undefined, { type: 'todos/noop' });
  return counterState.value + todosState.items.length;
});

const reducerObjectState: StoreWithReducerObjectsState = {
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false },
  [INTERNAL_SAGA_MANAGER_NAME]: {},
  counter: { value: 2 },
  todos: { items: ['a'] },
};
const reducerObjectSignatureState: StoreWithReducerObjectsState = {
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false },
  [INTERNAL_SAGA_MANAGER_NAME]: {},
  // @ts-expect-error reducer callable object must not be assignable as the counter state domain.
  counter: reducerObjectCounterReducer,
  todos: { items: [] },
};

if (false) {
  // @ts-expect-error Store.createSelector accepts only selectorFunc, not store as an extra first argument.
  storeWithCounter.createSelector(storeWithCounter, (state) => state.counter.value);
  // @ts-expect-error standalone createSelector requires a Store instance first.
  createSelector((state) => state.counter.value);
  // @ts-expect-error standalone createSelector requires selectorFunc as the second argument.
  createSelector(storeWithCounter);
}

const constructorInferredStore = new Store({ counterFromConstructor: counterReducer });

const selectConstructorInferredCounter = constructorInferredStore.createSelector((state) => {
  type _ConstructorSelectorStateIsStoreState = Assert<IsEqual<typeof state, StoreState<typeof constructorInferredStore>>>;
  const counterState: CounterState = state.counterFromConstructor;
  const updatesLocked: boolean = state[INTERNAL_STORE_UTILITY_DOMAIN].updatesLocked;
  // @ts-expect-error selector state exposes reducer return state, not raw reducer functions.
  const rawReducer: typeof counterReducer = state.counterFromConstructor;
  return counterState.value + Number(updatesLocked);
});

const selectedCounterValue: number = selectCounterValue.select(inferredState, 2);
const standaloneSelectedCounterValue: number = standaloneSelectCounterValue.select(inferredState, 2);
const standaloneReactSelectedCounterValue: number = standaloneReactSelectCounterValue.select(inferredState, 2);
// @ts-expect-error parameterized Store selectors still enforce argument types.
selectCounterValue.select(inferredState, 'wrong');
// @ts-expect-error parameterized ReactStore selectors still enforce argument types.
selectReactCounterValue.select(inferredState, 'wrong');

void selectFreshUpdatesLocked;
void selectConstructorInferredCounter;
void inferredState;
void wrongCounterState;
void selectedCounterValue;
void standaloneSelectedCounterValue;
void standaloneReactSelectedCounterValue;
void selectStreamingCounterValue;
void selectReactCounterValue;
void storeWithSelectorOptions;
void streamingStoreWithSelectorOptions;
void reactStoreWithSelectorOptions;
void selectReducerObjectDomains;
void reducerObjectState;
void reducerObjectSignatureState;
