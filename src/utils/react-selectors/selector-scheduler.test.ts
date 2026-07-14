import { signal } from "@preact/signals-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSelectorCadenceSource,
  type SelectorCadenceSource,
} from "../selector-core/throttled-selector-options";
import { createThrottledSignal } from "./selector-scheduler";

const createManualCadenceSource = () => {
  let cadenceListener: ((timestamp: number) => void) | null = null;
  const unsubscribeCadence = vi.fn(() => {
    cadenceListener = null;
  });
  const cadenceSource: SelectorCadenceSource = {
    frequency: 64,
    frameIntervalMs: 1000 / 64,
    getSnapshot: () => 0,
    subscribe: vi.fn((listener) => {
      cadenceListener = listener;
      return unsubscribeCadence;
    }),
    dispose: vi.fn(),
  };

  return {
    cadenceSource,
    tick: (timestamp = 0) => cadenceListener?.(timestamp),
    unsubscribeCadence,
  };
};

describe("createThrottledSignal", () => {
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
    const source = signal(42);
    const values: number[] = [];
    const unsubscribe = createThrottledSignal(source).subscribe((value) => values.push(value));

    expect(values).toEqual([42]);
    unsubscribe();
  });

  it("coalesces rapid timer-backed updates to the latest value", () => {
    const source = signal(0);
    const values: number[] = [];
    const unsubscribe = createThrottledSignal(source).subscribe((value) => values.push(value));

    source.value = 1;
    source.value = 2;
    source.value = 3;

    expect(values).toEqual([0]);
    vi.advanceTimersByTime(0);
    expect(values).toEqual([0, 3]);
    unsubscribe();
  });

  it("checks current source values on cadence ticks while watched", () => {
    const { cadenceSource, tick, unsubscribeCadence } = createManualCadenceSource();
    const source = signal(0);
    const values: number[] = [];

    const unsubscribe = createThrottledSignal(
      source,
      cadenceSource
    ).subscribe((value) => values.push(value));
    expect(cadenceSource.subscribe).toHaveBeenCalledTimes(1);

    source.value = 1;

    expect(cadenceSource.subscribe).toHaveBeenCalledTimes(1);
    expect(values).toEqual([0]);
    tick(0);
    expect(values).toEqual([0, 1]);
    tick(1);
    expect(values).toEqual([0, 1]);
    expect(unsubscribeCadence).not.toHaveBeenCalled();

    unsubscribe();
    expect(unsubscribeCadence).toHaveBeenCalledTimes(1);
  });

  it("uses the cadence source's configured FPS cadence with the timer fallback", () => {
    const source = signal(0);
    const values: number[] = [];
    const unsubscribe = createThrottledSignal(source, createSelectorCadenceSource(2.5)).subscribe((value) => values.push(value));

    source.value = 1;
    vi.advanceTimersByTime(0);
    expect(values).toEqual([0, 1]);

    source.value = 2;
    vi.advanceTimersByTime(399);
    expect(values).toEqual([0, 1]);

    vi.advanceTimersByTime(1);
    expect(values).toEqual([0, 1, 2]);
    unsubscribe();
  });

  it("batches multiple throttled signals from the same cadence tick", () => {
    const cadenceSource = createSelectorCadenceSource();
    const sourceA = signal("a1");
    const sourceB = signal("b1");
    const valuesA: string[] = [];
    const valuesB: string[] = [];
    const unsubscribeA = createThrottledSignal(sourceA, cadenceSource).subscribe((value) => valuesA.push(value));
    const unsubscribeB = createThrottledSignal(sourceB, cadenceSource).subscribe((value) => valuesB.push(value));

    sourceA.value = "a2";
    sourceB.value = "b2";

    expect(vi.getTimerCount()).toBe(1);
    expect(valuesA).toEqual(["a1"]);
    expect(valuesB).toEqual(["b1"]);

    vi.advanceTimersByTime(0);

    expect(valuesA).toEqual(["a1", "a2"]);
    expect(valuesB).toEqual(["b1", "b2"]);
    unsubscribeA();
    unsubscribeB();
  });

  it("defers re-entrant updates to the next cadence tick", () => {
    const cadenceSource = createSelectorCadenceSource(2.5);
    const source = signal(0);
    const reentrantSource = signal("x");
    const values: number[] = [];
    const reentrantValues: string[] = [];
    let pushDuringTick = true;

    const unsubscribeReentrant = createThrottledSignal(reentrantSource, cadenceSource).subscribe((value) => reentrantValues.push(value));
    const unsubscribe = createThrottledSignal(source, cadenceSource).subscribe((value) => {
      values.push(value);
      if (value === 1 && pushDuringTick) {
        pushDuringTick = false;
        reentrantSource.value = "y";
      }
    });

    source.value = 1;
    vi.advanceTimersByTime(0);
    expect(values).toEqual([0, 1]);
    expect(reentrantValues).toEqual(["x"]);

    vi.advanceTimersByTime(cadenceSource.frameIntervalMs);
    expect(reentrantValues).toEqual(["x", "y"]);

    unsubscribe();
    unsubscribeReentrant();
  });

  it("cleans up scheduled timer-backed cadence ticks when unwatched", () => {
    const source = signal(0);
    const values: number[] = [];
    const unsubscribe = createThrottledSignal(source).subscribe((value) => values.push(value));

    source.value = 1;
    expect(vi.getTimerCount()).toBe(1);

    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(0);
    expect(values).toEqual([0]);
  });

  it("rejects divergent FPS validation semantics", () => {
    for (const fps of [0, -1, 257, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => createSelectorCadenceSource(fps)).toThrow(
        'Store option "throttledSelectorFrequency" must be a finite number in the inclusive range 1..256 FPS.'
      );
    }
  });
});