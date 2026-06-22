import type { Observable as KefirObservable } from "kefir";
import type { ReadonlySignal } from "@preact/signals-react";
import type { Readable } from "svelte/store";
import { Store } from "@augmentcode/themis/svelte-store";
import { ReactStore } from "@augmentcode/themis/react-store";
import { StreamingStore } from "@augmentcode/themis/streaming-store";
import type { StoreInstanceState } from "@augmentcode/themis/types";
import { counterReducer } from "./counter/counter-slice";
import { todosReducer } from "./todos/todos-slice";

/**
 * Example Store used to create Store-bound selectors with inferred state.
 * App sagas are not auto-started by init(); start them explicitly with
 * their saga functions, for example `store.runSaga(counterSaga)`.
 * Runtime diagnostics are default-off; pass options such as
 * `{ sagaMonitor: true }` or `{ traceSelectors: true }` only while diagnosing.
 */
export const store = new Store({
  counter: counterReducer,
  todos: todosReducer,
});

export type ExampleState = StoreInstanceState<typeof store>;

/**
 * Explicit Svelte-readable Store variant.
 * Selector calls return Svelte Readable values after the Store is initialized.
 */
export const svelteStore = new Store({
  counter: counterReducer,
  todos: todosReducer,
});

export type SvelteExampleState = StoreInstanceState<typeof svelteStore>;

export const selectSvelteCount = svelteStore.createSelector((state) => state.counter.count);

export function createSvelteCountReadable(): Readable<number> {
  return selectSvelteCount();
}

/**
 * Explicit React signal Store variant.
 * Direct selector calls return Preact React signals; React components/custom
 * hooks use selector.use(...args) to receive the current plain value.
 */
export const reactStore = new ReactStore({
  counter: counterReducer,
  todos: todosReducer,
});

export type ReactExampleState = StoreInstanceState<typeof reactStore>;

export const selectReactCount = reactStore.createSelector((state) => state.counter.count);

export function createReactCountSignal(): ReadonlySignal<number> {
  return selectReactCount();
}

export function useReactCountValue(): number {
  return selectReactCount.use();
}

/**
 * Explicit Kefir/streaming Store variant.
 * Selector calls return Kefir Observable values after the Store is initialized.
 */
export const streamingStore = new StreamingStore(
  {
    counter: counterReducer,
    todos: todosReducer,
  },
  undefined,
  { throttledSelectorFrequency: 64 }
);

export type StreamingExampleState = StoreInstanceState<typeof streamingStore>;

export const selectStreamingCount = streamingStore.createSelector((state) => state.counter.count);

export function createStreamingCountObservable(): KefirObservable<number, any> {
  return selectStreamingCount();
}