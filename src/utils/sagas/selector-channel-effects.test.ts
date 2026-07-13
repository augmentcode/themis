import type { ReadonlySignal } from "@preact/signals-react";
import type { Observable } from "kefir";
import type { Readable } from "svelte/store";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { runSaga, type EventChannel } from "redux-saga";
import type { StoreSelector, StoreState } from "../../types";
import type { StoreReactSelector } from "../react-selectors/create-selector";
import type { StoreStreamingSelector } from "../streaming-selectors/create-selector";
import type { SelectorChannelPayload, SelectorChannelSelector } from "./selector-channel-effects";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";
import {
  createChannelFromSelector,
  takeEveryFromSelector,
  takeLatestFromSelector,
  takeLeadingFromSelector,
} from "./selector-channel-effects";

type CounterState = StoreState & {
  counter: { count: number };
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: boolean };
};

const withUtility = (count: number): CounterState => ({
  counter: { count },
  [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false },
});

const createMockReduxStore = (initialState: CounterState) => {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: vi.fn(() => state),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    setState(nextState: CounterState) {
      state = nextState;
      listeners.forEach((listener) => listener());
    },
    listenerCount() {
      return listeners.size;
    },
  };
};

const createCountSelector = () => ({
  select: vi.fn((state: CounterState, multiplier: number) => state.counter.count * multiplier),
}) as unknown as StoreSelector<number, [number], CounterState>;

const assertSelectorFamilyTypes = () => {
  type SvelteCountSelector = StoreSelector<number, [number], CounterState>;
  type ReactCountSelector = StoreReactSelector<number, [number], CounterState>;
  type StreamingCountSelector = StoreStreamingSelector<number, [number], CounterState>;

  expectTypeOf<SvelteCountSelector>().toMatchTypeOf<SelectorChannelSelector<number, [number], any>>();
  expectTypeOf<ReactCountSelector>().toMatchTypeOf<SelectorChannelSelector<number, [number], any>>();
  expectTypeOf<StreamingCountSelector>().toMatchTypeOf<SelectorChannelSelector<number, [number], any>>();
  expectTypeOf<ReturnType<SvelteCountSelector>>().toEqualTypeOf<Readable<number>>();
  expectTypeOf<ReturnType<ReactCountSelector>>().toEqualTypeOf<ReadonlySignal<number>>();
  expectTypeOf<ReturnType<StreamingCountSelector>>().toEqualTypeOf<Observable<number, any>>();

  const svelteSelector = {} as SvelteCountSelector;
  const reactSelector = {} as ReactCountSelector;
  const streamingSelector = {} as StreamingCountSelector;
  const noArgsSelector = {} as StoreSelector<boolean, [], CounterState>;
  const selectorArgs: [number] = [2];
  const signalArg = {} as ReadonlySignal<number>;
  const streamArg = {} as Observable<number, any>;

  expectTypeOf(createChannelFromSelector(svelteSelector, ...selectorArgs)).toEqualTypeOf<
    Generator<any, EventChannel<SelectorChannelPayload<number>>, any>
  >();
  expectTypeOf(createChannelFromSelector(reactSelector, ...selectorArgs)).toEqualTypeOf<
    Generator<any, EventChannel<SelectorChannelPayload<number>>, any>
  >();
  expectTypeOf(createChannelFromSelector(streamingSelector, ...selectorArgs)).toEqualTypeOf<
    Generator<any, EventChannel<SelectorChannelPayload<number>>, any>
  >();

  takeEveryFromSelector(noArgsSelector, function* (payload) {
    expectTypeOf(payload.payload).toEqualTypeOf<boolean>();
  });
  takeEveryFromSelector(reactSelector, selectorArgs, function* (payload) {
    expectTypeOf(payload.payload).toEqualTypeOf<number>();
  });
  takeLatestFromSelector(streamingSelector, selectorArgs, function* (payload) {
    expectTypeOf(payload.prevPayload).toEqualTypeOf<number | undefined | null>();
  });
  takeLeadingFromSelector(svelteSelector, selectorArgs, function* (payload) {
    expectTypeOf(payload.payload).toEqualTypeOf<number>();
  });

  // @ts-expect-error selector-channel helpers take plain selector args, not React signal args.
  createChannelFromSelector(reactSelector, signalArg);
  // @ts-expect-error selector-channel helpers take plain selector args, not Streaming observable args.
  takeEveryFromSelector(streamingSelector, [streamArg], function* () {});
};

describe("createChannelFromSelector", () => {
  it("accepts Svelte, React, and Streaming selectors through shared selector capabilities", () => {
    expect(assertSelectorFamilyTypes).toBeTypeOf("function");
  });

  it("reads and subscribes through the Redux store from saga context", async () => {
    const reduxStore = createMockReduxStore(withUtility(1));
    const selector = createCountSelector();

    function* createChannel() {
      return yield* createChannelFromSelector(selector, 2);
    }

    const channel = await runSaga(
      { context: { reduxStore } },
      createChannel
    ).toPromise() as EventChannel<SelectorChannelPayload<number>>;

    try {
      const nextPayload = new Promise<SelectorChannelPayload<number>>((resolve) => channel.take(resolve));
      reduxStore.setState(withUtility(3));
      const payload = await nextPayload;

      expect(payload).toEqual({ payload: 6, prevPayload: 2 });
    } finally {
      channel.close();
    }

    expect(reduxStore.subscribe).toHaveBeenCalledTimes(1);
    expect(reduxStore.getState).toHaveBeenCalled();
    expect(selector.select).toHaveBeenCalledWith(withUtility(1), 2);
    expect(reduxStore.listenerCount()).toBe(0);
  });

  it("requires a Redux store in saga context", async () => {
    function* watcher() {
      yield* createChannelFromSelector(createCountSelector(), 2);
    }

    await expect(runSaga({}, watcher).toPromise()).rejects.toThrow(
      "No Redux Store available in saga"
    );
  });
});