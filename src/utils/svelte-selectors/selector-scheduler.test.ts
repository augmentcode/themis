import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writable, get } from "svelte/store";
import {
  createSelectorFlushManager,
  type SelectorFlushCallback,
  type SelectorFlushManager,
} from "../selector-core/throttled-selector-options";
import { createThrottledReadable } from "./selector-scheduler";

let rafCallback: FrameRequestCallback | null = null;
let rafId = 0;
let rafTimestamp = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  rafCallback = null;
  rafId = 0;
  rafTimestamp = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      rafCallback = cb;
      return ++rafId;
    })
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const triggerRAF = (timestamp = (rafTimestamp += 1000 / 60)) => {
  const cb = rafCallback;
  rafCallback = null;
  cb?.(timestamp);
};

describe("createThrottledReadable", () => {
  it("delivers first value synchronously", () => {
    const source = writable(42);
    const throttled = createThrottledReadable(source);
    expect(get(throttled)).toBe(42);
  });

  it("defers subsequent updates to next animation frame", () => {
    const source = writable(1);
    const throttled = createThrottledReadable(source);
    const values: number[] = [];
    throttled.subscribe((v) => values.push(v));

    expect(values).toEqual([1]);

    source.set(2);
    expect(values).toEqual([1]);

    triggerRAF();
    expect(values).toEqual([1, 2]);
  });

  it("coalesces multiple rapid updates", () => {
    const source = writable(0);
    const throttled = createThrottledReadable(source);
    const values: number[] = [];
    throttled.subscribe((v) => values.push(v));

    expect(values).toEqual([0]);

    source.set(1);
    source.set(2);
    source.set(3);

    expect(values).toEqual([0]);

    triggerRAF();
    expect(values).toEqual([0, 3]);
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
    const source = writable(0);
    const throttled = createThrottledReadable(source, selectorFlushManager);
    const values: number[] = [];

    const unsubscribe = throttled.subscribe((value) => values.push(value));
    source.set(1);

    expect(selectorFlushManager.requestFlush).toHaveBeenCalledTimes(1);
    expect(values).toEqual([0]);
    requestedCallbacks[0](0);
    expect(values).toEqual([0, 1]);

    unsubscribe();
    expect(selectorFlushManager.cancelFlush).toHaveBeenCalledWith(
      requestedCallbacks[0]
    );
  });

  it("uses the manager's configured fractional FPS cadence without clamping", () => {
    const source = writable(0);
    const throttled = createThrottledReadable(source, createSelectorFlushManager(2.5));
    const values: number[] = [];
    throttled.subscribe((v) => values.push(v));

    source.set(1);
    triggerRAF(0);
    expect(values).toEqual([0, 1]);

    source.set(2);
    vi.advanceTimersByTime(399);
    triggerRAF(100);
    expect(values).toEqual([0, 1]);

    vi.advanceTimersByTime(1);
    triggerRAF(400);
    expect(values).toEqual([0, 1, 2]);
  });

  it("rejects non-finite or out-of-range FPS values", () => {
    for (const fps of [0, -1, 257, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => createSelectorFlushManager(fps)).toThrow(
        'Store option "throttledSelectorFrequency" must be a finite number in the inclusive range 1..256 FPS.'
      );
    }
  });

  it("skips notifying subscribers when the same object reference is emitted again", () => {
    const sharedObject = { value: 1 };
    const source = writable(sharedObject);
    const throttled = createThrottledReadable(source);
    const values: Array<{ value: number }> = [];
    throttled.subscribe((v) => values.push(v));

    expect(values).toEqual([sharedObject]);

    source.set(sharedObject);
    triggerRAF();

    expect(values).toEqual([sharedObject]);
  });

  it("batches multiple throttled readables in the same frame", () => {
    const selectorFlushManager = createSelectorFlushManager();
    const sourceA = writable("a1");
    const sourceB = writable("b1");
    const throttledA = createThrottledReadable(sourceA, selectorFlushManager);
    const throttledB = createThrottledReadable(sourceB, selectorFlushManager);

    const valuesA: string[] = [];
    const valuesB: string[] = [];
    throttledA.subscribe((v) => valuesA.push(v));
    throttledB.subscribe((v) => valuesB.push(v));

    expect(valuesA).toEqual(["a1"]);
    expect(valuesB).toEqual(["b1"]);

    sourceA.set("a2");
    sourceB.set("b2");

    expect(valuesA).toEqual(["a1"]);
    expect(valuesB).toEqual(["b1"]);

    triggerRAF();

    expect(valuesA).toEqual(["a1", "a2"]);
    expect(valuesB).toEqual(["b1", "b2"]);
  });

  it("handles re-entrant updates during flush", () => {
    const selectorFlushManager = createSelectorFlushManager();
    const source = writable(0);
    const reentrantSource = writable("x");
    const throttled = createThrottledReadable(source, selectorFlushManager);
    const throttledReentrant = createThrottledReadable(reentrantSource, selectorFlushManager);

    const reentrantValues: string[] = [];
    throttledReentrant.subscribe((v) => reentrantValues.push(v));

    let firstDeferred = true;
    throttled.subscribe((v) => {
      if (v === 1 && firstDeferred) {
        firstDeferred = false;
        reentrantSource.set("y");
      }
    });

    source.set(1);
    const rafCallsBefore = (requestAnimationFrame as ReturnType<typeof vi.fn>).mock.calls.length;
    triggerRAF();

    const rafCallsAfter = (requestAnimationFrame as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(rafCallsAfter).toBe(rafCallsBefore);

    vi.advanceTimersByTime(selectorFlushManager.frameIntervalMs);
    triggerRAF();
    expect(reentrantValues).toEqual(["x", "y"]);
  });

  it("cleans up on unsubscribe", () => {
    const source = writable(10);
    const throttled = createThrottledReadable(source);

    const values: number[] = [];
    const unsub = throttled.subscribe((v) => values.push(v));
    expect(values).toEqual([10]);

    source.set(20);
    expect((requestAnimationFrame as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    unsub();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);

    triggerRAF();

    expect(values).toEqual([10]);
  });

  it("schedules a cadence-limited frame if updates arrive during flush", () => {
    const selectorFlushManager = createSelectorFlushManager();
    const source = writable(0);
    const throttled = createThrottledReadable(source, selectorFlushManager);

    const values: number[] = [];
    let pushDuringFlush = true;
    throttled.subscribe((v) => {
      values.push(v);
      if (v === 1 && pushDuringFlush) {
        pushDuringFlush = false;
        source.set(2);
      }
    });

    source.set(1);
    triggerRAF();
    expect(values).toEqual([0, 1]);

    expect(rafCallback).toBeNull();

    vi.advanceTimersByTime(selectorFlushManager.frameIntervalMs);
    triggerRAF();
    expect(values).toEqual([0, 1, 2]);
  });

});