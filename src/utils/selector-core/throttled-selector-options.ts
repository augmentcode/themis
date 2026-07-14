export const DEFAULT_THROTTLED_SELECTOR_FREQUENCY = 64;
export const MIN_THROTTLED_SELECTOR_FREQUENCY = 1;
export const MAX_THROTTLED_SELECTOR_FREQUENCY = 256;

export type SelectorCadenceTickListener = (timestamp: number) => void;

export type SelectorCadenceSource = {
  readonly frequency: number;
  readonly frameIntervalMs: number;
  getSnapshot(): number;
  subscribe(listener: SelectorCadenceTickListener): () => void;
  dispose(): void;
};
export type SelectorCadenceSourceOptions = {
  traceSelectors?: boolean;
};
export type SelectorCadenceSourceProvider = () => SelectorCadenceSource;
export type SelectorCadenceSourceSource =
  | SelectorCadenceSource
  | SelectorCadenceSourceProvider
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

const getNextTickDelay = (
  lastTickWallTimeAt: number | null,
  frameIntervalMs: number,
  now: number,
): number => {
  return lastTickWallTimeAt === null
      ? 0
      : Math.max(0, frameIntervalMs - (now - lastTickWallTimeAt));
};

export const createSelectorCadenceSource = (
  throttledSelectorFrequency = DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  options: SelectorCadenceSourceOptions = {}
): SelectorCadenceSource => {
  const frequency = validateThrottledSelectorFrequency(throttledSelectorFrequency);
  const frameIntervalMs = 1000 / frequency;
  const traceSelectors = options.traceSelectors === true;
  const listeners = new Set<SelectorCadenceTickListener>();
  let frameId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let timerDueAt: number | null = null;
  let lastTickWallTimeAt: number | null = null;
  let latestTimestamp = 0;
  let disposed = false;

  const hasScheduledTick = () => frameId !== null || timerId !== null;

  const canRunScheduledTick = () => {
    if (disposed || listeners.size === 0) {
      return false;
    }
    return true;
  };

  const canScheduleTick = () =>
    canRunScheduledTick() && !hasScheduledTick();

  const clearScheduledTick = () => {
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
    runScheduledTick(timestamp);
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
    runScheduledTick(timestamp);
  };

  const scheduleFrame = (): void => {
    if (canScheduleTick()) {
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

  const runScheduledTick = (
    timestamp: number,
  ): void => {
    if (!canRunScheduledTick()) {
      return;
    }
    tick(timestamp);
  };

  const scheduleTick = (): void => {
    if (!canScheduleTick()) {
      return;
    }
    const delay = getNextTickDelay(
      lastTickWallTimeAt,
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

  const tick = (timestamp: number): void => {
    clearScheduledTick();
    if (disposed || listeners.size === 0) {
      return;
    }
    const listenersToNotify = Array.from(listeners);
    latestTimestamp = Math.max(Date.now(), timestamp);
    lastTickWallTimeAt = Date.now();
    if (traceSelectors) {
      console.info('SELECTOR CADENCE TICK', latestTimestamp, listenersToNotify.length);
    }
    for (const listener of listenersToNotify) {
      if (listeners.has(listener)) {
        listener(timestamp);
      }
    }
    scheduleTick();
  };

  const unsubscribe = (listener: SelectorCadenceTickListener): void => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearScheduledTick();
    }
  };

  return {
    frequency,
    frameIntervalMs,
    getSnapshot() {
      return latestTimestamp;
    },
    subscribe(listener) {
      if (disposed) {
        return () => undefined;
      }
      listeners.add(listener);
      if (traceSelectors) {
        console.info('SUBSCRIBE SELECTOR CADENCE', listeners.size);
      }
      if (canScheduleTick()) {
        scheduleTick();
      }
      return () => unsubscribe(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      clearScheduledTick();
    },
  };
};

export const resolveSelectorCadenceSource = (
  selectorCadenceSourceOrFrequency: SelectorCadenceSourceSource = DEFAULT_THROTTLED_SELECTOR_FREQUENCY
): SelectorCadenceSource => {
  if (typeof selectorCadenceSourceOrFrequency === 'number') {
    return createSelectorCadenceSource(selectorCadenceSourceOrFrequency);
  }
  if (typeof selectorCadenceSourceOrFrequency === 'function') {
    return selectorCadenceSourceOrFrequency();
  }
  return selectorCadenceSourceOrFrequency;
};