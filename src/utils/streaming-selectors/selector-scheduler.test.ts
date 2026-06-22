import Kefir from "kefir";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSelectorFlushManager,
  type SelectorFlushCallback,
  type SelectorFlushManager,
} from "../selector-core/throttled-selector-options";
import { createThrottledObservable } from "./selector-scheduler";

const createMutableProperty = <T>(initialValue: T) => {
  let emit: ((value: T) => void) | undefined;
  const stream = Kefir.stream<T, never>((emitter) => {
    emit = (value) => emitter.value(value);
    return () => {
      emit = undefined;
    };
  }).toProperty(() => initialValue);

  return {
    stream,
    set(value: T) {
      emit?.(value);
    },
  };
};

describe("createThrottledObservable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("delivers the first value promptly", () => {
    const source = createMutableProperty(42);
    const values: number[] = [];

    const subscription = createThrottledObservable(source.stream).observe((value) => values.push(value));

    expect(values).toEqual([42]);
    subscription.unsubscribe();
  });

  it("coalesces rapid timer-backed updates to the latest value", () => {
    const setTimeoutMock = vi.spyOn(globalThis, "setTimeout");
    const source = createMutableProperty(0);
    const values: number[] = [];
    const subscription = createThrottledObservable(source.stream).observe((value) => values.push(value));

    source.set(1);
    source.set(2);
    source.set(3);

    expect(values).toEqual([0]);
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(0);
    expect(values).toEqual([0, 3]);
    subscription.unsubscribe();
  });

  it("requests and cancels one-shot flush callbacks", () => {
    const requestedCallbacks: SelectorFlushCallback[] = [];
    const selectorFlushManager: SelectorFlushManager = {
      frequency: 64,
      frameIntervalMs: 1000 / 64,
      requestFlush: vi.fn((callback) => requestedCallbacks.push(callback)),
      cancelFlush: vi.fn(),
      dispose: vi.fn(),
    };
    const source = createMutableProperty(0);
    const values: number[] = [];

    const subscription = createThrottledObservable(
      source.stream,
      selectorFlushManager
    ).observe((value) => values.push(value));
    source.set(1);

    expect(selectorFlushManager.requestFlush).toHaveBeenCalledTimes(1);
    expect(values).toEqual([0]);
    requestedCallbacks[0](0);
    expect(values).toEqual([0, 1]);

    subscription.unsubscribe();
    expect(selectorFlushManager.cancelFlush).toHaveBeenCalledWith(
      requestedCallbacks[0]
    );
  });

  it("uses the manager's configured FPS cadence with the timer fallback", () => {
    const source = createMutableProperty(0);
    const values: number[] = [];
    const subscription = createThrottledObservable(source.stream, createSelectorFlushManager(2.5)).observe((value) => values.push(value));

    source.set(1);
    vi.advanceTimersByTime(0);
    expect(values).toEqual([0, 1]);

    source.set(2);
    vi.advanceTimersByTime(399);
    expect(values).toEqual([0, 1]);

    vi.advanceTimersByTime(1);
    expect(values).toEqual([0, 1, 2]);
    subscription.unsubscribe();
  });

  it("uses requestAnimationFrame when available and defaults to 64 FPS", () => {
    let rafCallback: FrameRequestCallback | null = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        rafCallback = callback;
        return 1;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const triggerRAF = (timestamp: number) => {
      const callback = rafCallback;
      rafCallback = null;
      callback?.(timestamp);
    };
    const source = createMutableProperty(0);
    const values: number[] = [];
    const subscription = createThrottledObservable(source.stream).observe((value) => values.push(value));

    source.set(1);
    triggerRAF(0);
    expect(values).toEqual([0, 1]);

    source.set(2);
    vi.advanceTimersByTime(15);
    triggerRAF(15);
    expect(values).toEqual([0, 1]);

    vi.advanceTimersByTime(1000 / 64 - 15);
    triggerRAF(1000 / 64);
    expect(values).toEqual([0, 1, 2]);
    subscription.unsubscribe();
  });

  it("rejects divergent FPS validation semantics", () => {
    for (const fps of [0, -1, 257, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => createSelectorFlushManager(fps)).toThrow(
        'Store option "throttledSelectorFrequency" must be a finite number in the inclusive range 1..256 FPS.'
      );
    }
  });

  it("batches multiple throttled observables from the same manager tick", () => {
    const selectorFlushManager = createSelectorFlushManager();
    const sourceA = createMutableProperty("a1");
    const sourceB = createMutableProperty("b1");
    const valuesA: string[] = [];
    const valuesB: string[] = [];

    const subscriptionA = createThrottledObservable(sourceA.stream, selectorFlushManager).observe((value) => valuesA.push(value));
    const subscriptionB = createThrottledObservable(sourceB.stream, selectorFlushManager).observe((value) => valuesB.push(value));

    sourceA.set("a2");
    sourceB.set("b2");

    expect(valuesA).toEqual(["a1"]);
    expect(valuesB).toEqual(["b1"]);

    vi.advanceTimersByTime(0);

    expect(valuesA).toEqual(["a1", "a2"]);
    expect(valuesB).toEqual(["b1", "b2"]);
    subscriptionA.unsubscribe();
    subscriptionB.unsubscribe();
  });
});