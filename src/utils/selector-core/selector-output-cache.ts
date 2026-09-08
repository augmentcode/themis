import type {
  SelectorOutputCacheKey,
  SelectorOutputCacheOptions,
  SelectorOutputFactory,
} from "../types";

export type {
  SelectorOutputCacheKey,
  SelectorOutputCacheOptions,
  SelectorOutputFactory,
} from "../types";

type PrimitiveCacheKey = string | number | boolean | bigint | symbol | null | undefined;

type SelectorOutputCacheNode = {
  weakChildren?: WeakMap<object, SelectorOutputCacheNode>;
  primitiveChildren?: Map<PrimitiveCacheKey, SelectorOutputCacheNode>;
  hasValue?: true;
  value?: unknown;
};

type SelectorOutputCacheTraceState = {
  observableCacheRequestCount: number;
  observableCacheCachedCount: number;
  outputCacheHitCount: number;
  outputCacheMissCount: number;
};

const isWeakCacheKey = (key: unknown): key is object =>
  (typeof key === "object" && key !== null) || typeof key === "function";

const getWeakChild = (node: SelectorOutputCacheNode, key: object): SelectorOutputCacheNode => {
  node.weakChildren ??= new WeakMap<object, SelectorOutputCacheNode>();

  const existing = node.weakChildren.get(key);
  if (existing) {
    return existing;
  }

  const child: SelectorOutputCacheNode = {};
  node.weakChildren.set(key, child);
  return child;
};

const getPrimitiveChild = (
  node: SelectorOutputCacheNode,
  key: PrimitiveCacheKey
): SelectorOutputCacheNode => {
  node.primitiveChildren ??= new Map<PrimitiveCacheKey, SelectorOutputCacheNode>();

  const existing = node.primitiveChildren.get(key);
  if (existing) {
    return existing;
  }

  const child: SelectorOutputCacheNode = {};
  node.primitiveChildren.set(key, child);
  return child;
};

const getChild = (node: SelectorOutputCacheNode, key: unknown): SelectorOutputCacheNode => {
  if (isWeakCacheKey(key)) {
    return getWeakChild(node, key);
  }

  return getPrimitiveChild(node, key as PrimitiveCacheKey);
};

const root: SelectorOutputCacheNode = {};
const traceStateByStateSource = new WeakMap<
  object,
  WeakMap<SelectorOutputCacheKey, SelectorOutputCacheTraceState>
>();

export const evictSelectorOutputsForStateSource = (stateSource: object): void => {
  root.weakChildren?.delete(stateSource);
  traceStateByStateSource.delete(stateSource);
};

export const evictSelectorOutput = (
  stateSource: object,
  selectorFunc: SelectorOutputCacheKey,
  selectorArgs: readonly unknown[],
  expectedOutput?: unknown
): void => {
  let current = root.weakChildren?.get(stateSource);
  if (!current) return;

  current = current.weakChildren?.get(selectorFunc);
  if (!current) return;

  for (const arg of selectorArgs) {
    current = isWeakCacheKey(arg)
      ? current.weakChildren?.get(arg)
      : current.primitiveChildren?.get(arg as PrimitiveCacheKey);
    if (!current) return;
  }

  if (!current.hasValue || (expectedOutput !== undefined && current.value !== expectedOutput)) {
    return;
  }

  current.hasValue = undefined;
  current.value = undefined;
};

const getTraceState = (
  stateSource: object,
  selectorFunc: SelectorOutputCacheKey
): SelectorOutputCacheTraceState => {
  let traceStateBySelector = traceStateByStateSource.get(stateSource);
  if (!traceStateBySelector) {
    traceStateBySelector = new WeakMap();
    traceStateByStateSource.set(stateSource, traceStateBySelector);
  }
  const existing = traceStateBySelector.get(selectorFunc);
  if (existing) {
    return existing;
  }

  const state = {
    observableCacheRequestCount: 0,
    observableCacheCachedCount: 0,
    outputCacheHitCount: 0,
    outputCacheMissCount: 0,
  };
  traceStateBySelector.set(selectorFunc, state);
  return state;
};

const reportCacheTrace = (
  selectorFunc: SelectorOutputCacheKey,
  options: SelectorOutputCacheOptions | undefined,
  traceState: SelectorOutputCacheTraceState | undefined,
  outputCacheStatus: "hit" | "miss"
): void => {
  if (!traceState) return;

  options?.traceReporter?.({
    selectorFunc: selectorFunc as any,
    observableCacheRequestCount: traceState.observableCacheRequestCount,
    observableCacheCachedCount: traceState.observableCacheCachedCount,
    outputCacheStatus,
    outputCacheRequestCount: traceState.observableCacheRequestCount,
    outputCacheHitCount: traceState.outputCacheHitCount,
    outputCacheMissCount: traceState.outputCacheMissCount,
  });
};

export const getOrCreate = <OUTPUT>(
  stateSource: object,
  selectorFunc: SelectorOutputCacheKey,
  selectorArgs: readonly unknown[],
  factory: SelectorOutputFactory<OUTPUT>,
  options?: SelectorOutputCacheOptions
): OUTPUT => {
  const traceState = options?.traceReporter ? getTraceState(stateSource, selectorFunc) : undefined;
  if (traceState) {
    traceState.observableCacheRequestCount += 1;
  }

  let current = getChild(root, stateSource);
  current = getChild(current, selectorFunc);

  for (const arg of selectorArgs) {
    current = getChild(current, arg);
  }

  if (current.hasValue) {
    if (traceState) {
      traceState.outputCacheHitCount += 1;
    }
    reportCacheTrace(selectorFunc, options, traceState, "hit");
    return current.value as OUTPUT;
  }

  const value = factory();
  current.value = value;
  current.hasValue = true;
  if (traceState) {
    traceState.observableCacheCachedCount += 1;
    traceState.outputCacheMissCount += 1;
  }
  reportCacheTrace(selectorFunc, options, traceState, "miss");
  return value;
};