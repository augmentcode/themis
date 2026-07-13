import type { SelectorTraceReporter } from "./create-cached-selector";

export type SelectorOutputCacheKey = (...args: any[]) => unknown;

export type SelectorOutputFactory<OUTPUT> = () => OUTPUT;

export type SelectorOutputCacheOptions = {
  traceReporter?: SelectorTraceReporter<any, any, any[]>;
};

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
const traceStateBySelector = new WeakMap<SelectorOutputCacheKey, SelectorOutputCacheTraceState>();

const getTraceState = (selectorFunc: SelectorOutputCacheKey): SelectorOutputCacheTraceState => {
  const existing = traceStateBySelector.get(selectorFunc);
  if (existing) {
    return existing;
  }

  const state = {
    observableCacheRequestCount: 0,
    observableCacheCachedCount: 0,
  };
  traceStateBySelector.set(selectorFunc, state);
  return state;
};

const reportCacheTrace = (
  selectorFunc: SelectorOutputCacheKey,
  options: SelectorOutputCacheOptions | undefined,
  traceState: SelectorOutputCacheTraceState | undefined
): void => {
  if (!traceState) return;

  options?.traceReporter?.({
    selectorFunc: selectorFunc as any,
    observableCacheRequestCount: traceState.observableCacheRequestCount,
    observableCacheCachedCount: traceState.observableCacheCachedCount,
  });
};

export const getOrCreate = <OUTPUT>(
  stateSource: object,
  selectorFunc: SelectorOutputCacheKey,
  selectorArgs: readonly unknown[],
  factory: SelectorOutputFactory<OUTPUT>,
  options?: SelectorOutputCacheOptions
): OUTPUT => {
  const traceState = options?.traceReporter ? getTraceState(selectorFunc) : undefined;
  if (traceState) {
    traceState.observableCacheRequestCount += 1;
  }

  let current = getChild(root, stateSource);
  current = getChild(current, selectorFunc);

  for (const arg of selectorArgs) {
    current = getChild(current, arg);
  }

  if (current.hasValue) {
    reportCacheTrace(selectorFunc, options, traceState);
    return current.value as OUTPUT;
  }

  const value = factory();
  current.value = value;
  current.hasValue = true;
  if (traceState) {
    traceState.observableCacheCachedCount += 1;
  }
  reportCacheTrace(selectorFunc, options, traceState);
  return value;
};