import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSelectorCadenceSource,
  DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
} from "./throttled-selector-options";

describe("createSelectorCadenceSource", () => {
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

  it("defaults to the documented 64 FPS cadence", () => {
    const cadenceSource = createSelectorCadenceSource();

    expect(cadenceSource.frequency).toBe(DEFAULT_THROTTLED_SELECTOR_FREQUENCY);
    expect(cadenceSource.frameIntervalMs).toBe(1000 / DEFAULT_THROTTLED_SELECTOR_FREQUENCY);

    cadenceSource.dispose();
  });

  it("rate-limits explicitly requested fractional-FPS ticks and exposes the latest snapshot", () => {
    const cadenceSource = createSelectorCadenceSource(2.5);
    const listener = vi.fn();

    const unsubscribe = cadenceSource.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    cadenceSource.requestTick();
    vi.advanceTimersByTime(0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cadenceSource.getSnapshot()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(399);
    cadenceSource.requestTick();
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(cadenceSource.getSnapshot()).toBe(400);
    expect(vi.getTimerCount()).toBe(0);

    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays idle after subscription, coalesces requests, and clears work after last unsubscribe", () => {
    const cadenceSource = createSelectorCadenceSource(64);
    const setTimeoutMock = vi.spyOn(globalThis, "setTimeout");
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    const unsubscribeA = cadenceSource.subscribe(listenerA);
    const unsubscribeB = cadenceSource.subscribe(listenerB);

    expect(setTimeoutMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    cadenceSource.requestTick();
    cadenceSource.requestTick();
    cadenceSource.requestTick();
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    unsubscribeA();
    expect(vi.getTimerCount()).toBe(1);
    unsubscribeB();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disposes timer-backed scheduled work", () => {
    const cadenceSource = createSelectorCadenceSource(64);
    cadenceSource.subscribe(vi.fn());
    expect(vi.getTimerCount()).toBe(0);

    cadenceSource.requestTick();
    expect(vi.getTimerCount()).toBe(1);

    cadenceSource.dispose();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("defers listeners added during a tick to the next cadence tick", () => {
    const cadenceSource = createSelectorCadenceSource(2.5);
    const listenerB = vi.fn();
    let unsubscribeB: (() => void) | undefined;
    const listenerA = vi.fn(() => {
      unsubscribeB ??= cadenceSource.subscribe(listenerB);
    });

    const unsubscribeA = cadenceSource.subscribe(listenerA);
    cadenceSource.requestTick();
    vi.advanceTimersByTime(0);

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(400);
    expect(listenerB).not.toHaveBeenCalled();

    cadenceSource.requestTick();
    vi.advanceTimersByTime(0);
    expect(listenerB).toHaveBeenCalledTimes(1);

    unsubscribeA();
    unsubscribeB?.();
    cadenceSource.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});