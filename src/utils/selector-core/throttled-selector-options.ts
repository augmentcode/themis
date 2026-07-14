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

export type SelectorFlushCallback = SelectorCadenceTickListener;

/** @deprecated Use SelectorCadenceSource instead. */
export type SelectorFlushManager = {
  readonly frequency: number;
  readonly frameIntervalMs: number;
  requestFlush(callback: SelectorFlushCallback): void;
  cancelFlush(callback: SelectorFlushCallback): void;
  dispose(): void;
};
/** @deprecated Use SelectorCadenceSourceOptions instead. */
export type SelectorFlushManagerOptions = SelectorCadenceSourceOptions;
/** @deprecated Use SelectorCadenceSourceProvider instead. */
export type SelectorFlushManagerProvider = () => SelectorFlushManager;
/** @deprecated Use SelectorCadenceSourceSource instead. */
export type SelectorFlushManagerSource =
  | SelectorFlushManager
  | SelectorFlushManagerProvider
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

const isSelectorCadenceSource = (source: unknown): source is SelectorCadenceSource => {
  if (!source || typeof source !== 'object') {
    return false;
  }

  return 'subscribe' in source && typeof source.subscribe === 'function';
};

const isSelectorFlushManager = (source: unknown): source is SelectorFlushManager => {
  if (!source || typeof source !== 'object') {
    return false;
  }

  return 'requestFlush' in source && typeof source.requestFlush === 'function';
};

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

/** @deprecated Use createSelectorCadenceSource instead. */
export const createSelectorFlushManager = (
  throttledSelectorFrequencyOrSource: number | SelectorCadenceSource = DEFAULT_THROTTLED_SELECTOR_FREQUENCY,
  options: SelectorFlushManagerOptions = {}
): SelectorFlushManager => {
  const ownsCadenceSource = typeof throttledSelectorFrequencyOrSource === 'number';
  const cadenceSource = ownsCadenceSource
    ? createSelectorCadenceSource(throttledSelectorFrequencyOrSource, options)
    : throttledSelectorFrequencyOrSource;
  const pendingCallbacks = new Map<SelectorFlushCallback, () => void>();
  let disposed = false;

  const cancelFlush = (callback: SelectorFlushCallback): void => {
    pendingCallbacks.get(callback)?.();
    pendingCallbacks.delete(callback);
  };

  return {
    frequency: cadenceSource.frequency,
    frameIntervalMs: cadenceSource.frameIntervalMs,
    requestFlush(callback) {
      if (disposed || pendingCallbacks.has(callback)) {
        return;
      }
      if (options.traceSelectors === true) {
        console.info('REQUEST FLUSH', callback);
      }
      let unsubscribe: (() => void) | undefined;
      const runCallback = (timestamp: number): void => {
        pendingCallbacks.delete(callback);
        unsubscribe?.();
        if (options.traceSelectors === true) {
          console.info('START FLUSHING', Math.max(Date.now(), timestamp));
        }
        callback(timestamp);
        if (options.traceSelectors === true) {
          console.info('FLUSHED', Date.now(), 1);
        }
      };
      unsubscribe = cadenceSource.subscribe(runCallback);
      pendingCallbacks.set(callback, unsubscribe);
    },
    cancelFlush,
    dispose() {
      disposed = true;
      for (const unsubscribe of pendingCallbacks.values()) {
        unsubscribe();
      }
      pendingCallbacks.clear();
      if (ownsCadenceSource) {
        cadenceSource.dispose();
      }
    },
  };
};

/** @deprecated Use resolveSelectorCadenceSource instead. */
export const resolveSelectorFlushManager = (
  selectorFlushManagerOrFrequency: SelectorFlushManagerSource = DEFAULT_THROTTLED_SELECTOR_FREQUENCY
): SelectorFlushManager => {
  if (typeof selectorFlushManagerOrFrequency === 'number') {
    return createSelectorFlushManager(selectorFlushManagerOrFrequency);
  }
  if (typeof selectorFlushManagerOrFrequency === 'function') {
    return resolveSelectorFlushManager(selectorFlushManagerOrFrequency());
  }
  if (isSelectorFlushManager(selectorFlushManagerOrFrequency)) {
    return selectorFlushManagerOrFrequency;
  }
  if (isSelectorCadenceSource(selectorFlushManagerOrFrequency)) {
    return createSelectorFlushManager(selectorFlushManagerOrFrequency);
  }
  return selectorFlushManagerOrFrequency;
};