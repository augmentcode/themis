export const DEFAULT_THROTTLED_SELECTOR_FREQUENCY = 64;
export const MIN_THROTTLED_SELECTOR_FREQUENCY = 1;
export const MAX_THROTTLED_SELECTOR_FREQUENCY = 256;

export type SelectorFlushCallback = (timestamp: number) => void;

export type SelectorFlushManager = {
  readonly frequency: number;
  readonly frameIntervalMs: number;
  requestFlush(callback: SelectorFlushCallback): void;
  cancelFlush(callback: SelectorFlushCallback): void;
  dispose(): void;
};
export type SelectorFlushManagerOptions = {
  traceSelectors?: boolean;
};
export type SelectorFlushManagerProvider = () => SelectorFlushManager;
export type SelectorFlushManagerSource =
  | SelectorFlushManager
  | SelectorFlushManagerProvider
  | number;

export const validateThrottledSelectorFrequency = (frequency: number): number => {
  if (
    typeof frequency !== 'number' ||
    !Number.isFinite(frequency) ||
    frequency < MIN_THROTTLED_SELECTOR_FREQUENCY ||
    frequency > MAX_THROTTLED_SELECTOR_FREQUENCY
  ) {
    throw new RangeError(
      `Store option "throttledSelectorFrequency" must be a finite number in the inclusive range 1..256 FPS. Received ${String(frequency)}.`
    );
  }

  return frequency;
};

const hasRAF = (): boolean => typeof requestAnimationFrame === 'function';

const getNextFlushDelay = (
  lastFlushWallTimeAt: number | null,
  frameIntervalMs: number,
  now: number,
): number => {
  return lastFlushWallTimeAt === null
      ? 0
      : Math.max(0, frameIntervalMs - (now - lastFlushWallTimeAt));
};

export const createSelectorFlushManager = (
  throttledSelectorFrequency = DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  options: SelectorFlushManagerOptions = {}
): SelectorFlushManager => {
  const frequency = validateThrottledSelectorFrequency(throttledSelectorFrequency);
  const frameIntervalMs = 1000 / frequency;
  const traceSelectors = options.traceSelectors === true;
  let queuedCallbacks = new Set<SelectorFlushCallback>();
  let frameId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let timerDueAt: number | null = null;
  let lastFlushWallTimeAt: number | null = null;
  let flushingCallbacks: Set<SelectorFlushCallback> | null = null;
  let disposed = false;

  const hasScheduledFlush = () => frameId !== null || timerId !== null;

  const canRunScheduledFlush = () => {
    if (disposed || queuedCallbacks.size === 0) {
      return false;
    }
    return true;
  };

  const canScheduleFlush = () =>
    canRunScheduledFlush() && !hasScheduledFlush();

  const clearScheduledFlush = () => {
    if (frameId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameId);
      }
      frameId = null;
    }
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    timerDueAt = null;
  };

  const runFrame = (timestamp: number): void => {
    frameId = null;
    if (timerDueAt !== null) {
      if (Math.max(Date.now(), timestamp) < timerDueAt) {
        scheduleFrame();
        return;
      }
      timerDueAt = null;
    }
    runScheduledFlush(timestamp);
  };

  const runTimer = (timestamp: number): void => {
    timerId = null;
    if (timerDueAt !== null && Date.now() < timerDueAt) {
      const remainingDelayMs = timerDueAt - Date.now();
      if (hasRAF() && remainingDelayMs < 1) {
        scheduleFrame();
        return;
      }
      timerId = setTimeout(() => {
        runTimer(Date.now());
      }, remainingDelayMs);
      return;
    }
    timerDueAt = null;
    if (hasRAF()) {
      scheduleFrame();
      return;
    }
    runScheduledFlush(timestamp);
  };

  const scheduleFrame = (): void => {
    if (canScheduleFlush()) {
      frameId = requestAnimationFrame(runFrame);
    }
  };

  const scheduleTimer = (delayMs: number): void => {
    timerDueAt = Date.now() + delayMs;
    const timerDelayMs = hasRAF() ? Math.floor(delayMs) : delayMs;
    timerId = setTimeout(() => {
      runTimer(Date.now());
    }, timerDelayMs);
  };

  const runScheduledFlush = (
    timestamp: number,
  ): void => {
    if (!canRunScheduledFlush()) {
      return;
    }
    flush(timestamp);
  };

  const scheduleFlush = (): void => {
    if (!canScheduleFlush()) {
      return;
    }
    const delay = getNextFlushDelay(
      lastFlushWallTimeAt,
      frameIntervalMs,
      Date.now(),
    );
    if (delay > 0) {
      scheduleTimer(delay);
      return;
    }
    if (hasRAF()) {
      scheduleFrame();
    } else {
      scheduleTimer(0);
    }
  };

  const flush = (timestamp: number): void => {
    clearScheduledFlush();
    if (disposed || queuedCallbacks.size === 0) {
      return;
    }
    if (traceSelectors) {
      console.info('START FLUSHING', Math.max(Date.now(), timestamp));
    }
    const callbacksToFlush = queuedCallbacks;
    queuedCallbacks = new Set();
    flushingCallbacks = callbacksToFlush;
    lastFlushWallTimeAt = Date.now();
    for (const callback of callbacksToFlush) {
      callback(timestamp);
    }
    flushingCallbacks = null;
    if (traceSelectors) {
      console.info('FLUSHED', lastFlushWallTimeAt, callbacksToFlush.size);
    }
  };

  return {
    frequency,
    frameIntervalMs,
    requestFlush(callback) {
      if (traceSelectors) {
        console.info('REQUEST FLUSH', callback);
      }
      if (disposed) {
        return;
      }
      queuedCallbacks.add(callback);
      if (canScheduleFlush()) {
        scheduleFlush();
      }
    },
    cancelFlush(callback) {
      queuedCallbacks.delete(callback);
      flushingCallbacks?.delete(callback);
      if (queuedCallbacks.size === 0) {
        clearScheduledFlush();
      }
    },
    dispose() {
      disposed = true;
      queuedCallbacks.clear();
      clearScheduledFlush();
    },
  };
};

export const resolveSelectorFlushManager = (
  selectorFlushManagerOrFrequency: SelectorFlushManagerSource = DEFAULT_THROTTLED_SELECTOR_FREQUENCY
): SelectorFlushManager => {
  if (typeof selectorFlushManagerOrFrequency === 'number') {
    return createSelectorFlushManager(selectorFlushManagerOrFrequency);
  }
  if (typeof selectorFlushManagerOrFrequency === 'function') {
    return selectorFlushManagerOrFrequency();
  }
  return selectorFlushManagerOrFrequency;
};