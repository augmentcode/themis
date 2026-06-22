import { describe, expect, it, vi } from "vitest";
import { runSaga, type EventChannel } from "redux-saga";
import type { StoreSelector, StoreState } from "../../types";
import type { SelectorChannelPayload } from "./selector-channel-effects";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";
import { createChannelFromSelector } from "./selector-channel-effects";

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

describe("createChannelFromSelector", () => {
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