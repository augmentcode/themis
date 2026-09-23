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
  // Upper bound: weak-key GC can remove entries without an explicit eviction.
  cachedEntryCount?: number;
  operationCount?: number;
};

// Transient only. Never attach traversal paths to a node or a release callback.
type SelectorOutputCachePath = { node: SelectorOutputCacheNode; key: unknown }[];

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

const prunePath = (path: SelectorOutputCachePath): void => {
  for (let i = path.length - 1; i > 0; i -= 1) {
    const { node, key } = path[i];
    if (node.cachedEntryCount || node.operationCount) break;

    const parent = path[i - 1].node;
    if (isWeakCacheKey(key)) {
      if (parent.weakChildren?.get(key) === node) parent.weakChildren.delete(key);
    } else {
      const children = parent.primitiveChildren;
      if (children?.get(key as PrimitiveCacheKey) === node) {
        children.delete(key as PrimitiveCacheKey);
        if (children.size === 0) parent.primitiveChildren = undefined;
      }
    }
  }
};

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

  const path: SelectorOutputCachePath = [{ node: current, key: undefined }];
  for (const arg of selectorArgs) {
    current = isWeakCacheKey(arg)
      ? current.weakChildren?.get(arg)
      : current.primitiveChildren?.get(arg as PrimitiveCacheKey);
    if (!current) return;
    path.push({ node: current, key: arg });
  }

  if (!current.hasValue || (expectedOutput !== undefined && current.value !== expectedOutput)) {
    return;
  }

  current.hasValue = undefined;
  current.value = undefined;
  for (const { node } of path) node.cachedEntryCount = (node.cachedEntryCount ?? 0) - 1;
  prunePath(path);
};

// Keep the release closure out of getOrCreate's traversal/ancestor lexical scope.
const createOutput = <OUTPUT>(
  stateSource: object,
  selectorFunc: SelectorOutputCacheKey,
  selectorArgs: readonly unknown[],
  factory: SelectorOutputFactory<OUTPUT>
): OUTPUT => {
  let value: OUTPUT;
  const releaseInactiveOutput = () => {
    evictSelectorOutput(stateSource, selectorFunc, selectorArgs, value);
  };
  value = factory(releaseInactiveOutput);
  return value;
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

  const path: SelectorOutputCachePath = [{ node: current, key: undefined }];
  for (const arg of selectorArgs) {
    current = getChild(current, arg);
    path.push({ node: current, key: arg });
  }

  for (const { node } of path) node.operationCount = (node.operationCount ?? 0) + 1;
  try {
    if (current.hasValue) {
      if (traceState) {
        traceState.outputCacheHitCount += 1;
      }
      reportCacheTrace(selectorFunc, options, traceState, "hit");
      // A synchronous reporter can release/replace this very leaf, or dispose its source.
      return current.value as OUTPUT;
    }

    const value = createOutput(stateSource, selectorFunc, selectorArgs, factory);
    // A nested factory may already have installed a value; outer overwrite is one entry.
    if (!current.hasValue) {
      for (const { node } of path) node.cachedEntryCount = (node.cachedEntryCount ?? 0) + 1;
    }
    current.value = value;
    current.hasValue = true;
    if (traceState) {
      traceState.observableCacheCachedCount += 1;
      traceState.outputCacheMissCount += 1;
    }
    reportCacheTrace(selectorFunc, options, traceState, "miss");
    return value;
  } finally {
    // Return expressions above are evaluated before unpinning, including hit leaf reads.
    for (const { node } of path) node.operationCount! -= 1;
    prunePath(path);
  }
};