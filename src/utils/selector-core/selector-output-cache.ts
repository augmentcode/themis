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
let observableCacheRequestCount = 0;
let observableCacheCachedCount = 0;

const reportCacheTrace = (
  selectorFunc: SelectorOutputCacheKey,
  options: SelectorOutputCacheOptions | undefined
): void => {
  options?.traceReporter?.({
    selectorFunc: selectorFunc as any,
    observableCacheRequestCount,
    observableCacheCachedCount,
  });
};

export const getOrCreate = <OUTPUT>(
  stateSource: object,
  selectorFunc: SelectorOutputCacheKey,
  selectorArgs: readonly unknown[],
  factory: SelectorOutputFactory<OUTPUT>,
  options?: SelectorOutputCacheOptions
): OUTPUT => {
  if (options?.traceReporter) {
    observableCacheRequestCount += 1;
  }

  let current = getChild(root, stateSource);
  current = getChild(current, selectorFunc);

  for (const arg of selectorArgs) {
    current = getChild(current, arg);
  }

  if (current.hasValue) {
    reportCacheTrace(selectorFunc, options);
    return current.value as OUTPUT;
  }

  const value = factory();
  current.value = value;
  current.hasValue = true;
  if (options?.traceReporter) {
    observableCacheCachedCount += 1;
  }
  reportCacheTrace(selectorFunc, options);
  return value;
};