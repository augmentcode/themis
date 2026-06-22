import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSelectorFlushManager } from "./throttled-selector-options";

describe("createSelectorFlushManager", () => {
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

  it("coalesces many timer-backed requestFlush calls into one scheduled timeout and callback pass", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const setTimeoutMock = vi.spyOn(globalThis, "setTimeout");
    const manager = createSelectorFlushManager(2.5);
    const callback = vi.fn();

    manager.requestFlush(callback);
    manager.requestFlush(callback);
    manager.requestFlush(callback);

    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  it("logs selector flush traces only when tracing is enabled", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const manager = createSelectorFlushManager(2.5, { traceSelectors: true });
    const callback = vi.fn();

    manager.requestFlush(callback);
    vi.advanceTimersByTime(0);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(consoleInfo).toHaveBeenCalledWith("REQUEST FLUSH", callback);
    expect(consoleInfo).toHaveBeenCalledWith("START FLUSHING", expect.any(Number));
    expect(consoleInfo).toHaveBeenCalledWith("FLUSHED", expect.any(Number), 1);
  });

  it("flushes only callbacks queued in the current timer-backed window", () => {
    const manager = createSelectorFlushManager(2.5);
    const callbackA = vi.fn();
    const callbackB = vi.fn();

    manager.requestFlush(callbackA);
    manager.requestFlush(callbackA);
    vi.advanceTimersByTime(0);

    expect(callbackA).toHaveBeenCalledTimes(1);
    expect(callbackB).not.toHaveBeenCalled();
  });

  it("cadence-limits re-entrant timer-backed requestFlush calls with one future timeout", () => {
    const setTimeoutMock = vi.spyOn(globalThis, "setTimeout");
    const manager = createSelectorFlushManager(2.5);
    const timestamps: number[] = [];
    const callback = (timestamp: number) => {
      timestamps.push(timestamp);
      if (timestamps.length === 1) {
        manager.requestFlush(callback);
        manager.requestFlush(callback);
      }
    };

    manager.requestFlush(callback);
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(0);
    expect(timestamps).toEqual([0]);
    expect(setTimeoutMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(399);
    expect(timestamps).toEqual([0]);
    expect(setTimeoutMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    expect(timestamps).toEqual([0, 400]);
  });

  it("coalesces repeated RAF-backed requestFlush calls across the timer-to-frame chain", () => {
    const setTimeoutMock = vi.spyOn(globalThis, "setTimeout");
    let rafCallback: FrameRequestCallback | null = null;
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafCallback = callback;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const triggerRAF = (timestamp: number) => {
      const callback = rafCallback;
      rafCallback = null;
      callback?.(timestamp);
    };
    const manager = createSelectorFlushManager(2.5);
    const callback = vi.fn();

    manager.requestFlush(callback);
    manager.requestFlush(callback);
    manager.requestFlush(callback);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(setTimeoutMock).not.toHaveBeenCalled();

    triggerRAF(0);
    expect(callback).toHaveBeenCalledTimes(1);

    manager.requestFlush(callback);
    manager.requestFlush(callback);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(399);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(2);
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    manager.requestFlush(callback);
    manager.requestFlush(callback);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(2);
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    triggerRAF(400);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("cancels queued callbacks before they flush", () => {
    const manager = createSelectorFlushManager(2.5);
    const callback = vi.fn();

    manager.requestFlush(callback);
    manager.cancelFlush(callback);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(0);
    expect(callback).not.toHaveBeenCalled();
  });

  it("cancels queued callbacks that have not run yet in the active flush", () => {
    const manager = createSelectorFlushManager(2.5);
    const callbackB = vi.fn();
    const callbackA = vi.fn(() => manager.cancelFlush(callbackB));

    manager.requestFlush(callbackA);
    manager.requestFlush(callbackB);
    vi.advanceTimersByTime(0);

    expect(callbackA).toHaveBeenCalledTimes(1);
    expect(callbackB).not.toHaveBeenCalled();
  });
});