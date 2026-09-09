import { shallowEqual } from "fast-equals";
import type {
  AccessedPath,
  CachedSelector,
  CreateCachedSelectorOptions,
  SelectorArgumentChange,
  SelectorInvalidationReason,
  SelectorResultOutcome,
} from "../types";

export type {
  AccessedPath,
  CachedSelector,
  CreateCachedSelectorOptions,
  SelectorAccessTrace,
  SelectorArgumentChange,
  SelectorComputationTraceOptions,
  SelectorInvalidationReason,
  SelectorOutputCacheTrace,
  SelectorResultOutcome,
  SelectorTrace,
  SelectorTraceReporter,
} from "../types";

const proxyValuesWeakMap = new WeakMap<object, unknown>();
const collectionFieldsSet = new Set(["idField", "ids", "map", "refsCount"]);
const safePropertyNameRegex = /^[A-Za-z_$][0-9A-Za-z_$]*$/;
const redactedArgumentPathSegment = "<selector-argument>";

const renderAccessedPathSegment = (segment: string | symbol, index: number): string => {
  if (typeof segment === "symbol") {
    return `[${String(segment)}]`;
  }

  if (index === 0 && safePropertyNameRegex.test(segment)) {
    return segment;
  }

  if (safePropertyNameRegex.test(segment)) {
    return `.${segment}`;
  }

  return `[${JSON.stringify(segment)}]`;
};

export const renderAccessedPath = (path: AccessedPath): string =>
  path.map(renderAccessedPathSegment).join("");

export const renderAccessedPaths = (
  accessedPaths: Set<string>,
  parsedPaths: Map<string, AccessedPath>
): string[] =>
  Array.from(accessedPaths)
    .map((pathString) => parsedPaths.get(pathString))
    .filter((path): path is AccessedPath => Boolean(path))
    .map(renderAccessedPath)
    .sort();

const getArgumentPropertyKeys = (args: readonly unknown[]): Set<string | symbol> => {
  const keys = new Set<string | symbol>();
  for (const arg of args) {
    if (typeof arg === "symbol") {
      keys.add(arg);
    } else if (arg === null || typeof arg !== "object" && typeof arg !== "function") {
      keys.add(String(arg));
    }
  }
  return keys;
};

const redactAccessedPathMetadata = (
  accessedPaths: Set<string> | undefined,
  parsedPaths: Map<string, AccessedPath>,
  argumentPropertyKeys: Set<string | symbol>
): { accessedPaths: Set<string>; parsedPaths: Map<string, AccessedPath> } => {
  const redactedPaths = new Set<string>();
  const redactedParsedPaths = new Map<string, AccessedPath>();
  for (const pathString of accessedPaths ?? []) {
    const path = parsedPaths.get(pathString);
    if (!path) continue;
    const redactedPath = path.map((segment) =>
      argumentPropertyKeys.has(segment) ? redactedArgumentPathSegment : segment
    );
    const redactedPathString = JSON.stringify(redactedPath);
    redactedPaths.add(redactedPathString);
    redactedParsedPaths.set(redactedPathString, redactedPath);
  }
  return { accessedPaths: redactedPaths, parsedPaths: redactedParsedPaths };
};

export const getRawValue = <R>(maybeProxy: R): R => {
  if (maybeProxy === null || (typeof maybeProxy !== "object" && typeof maybeProxy !== "function")) {
    return maybeProxy;
  }

  return (proxyValuesWeakMap.get(maybeProxy as object) as R | undefined) ?? maybeProxy;
};

const isCollectionLike = (item: object): boolean => {
  const record = item as Record<string, unknown>;

  if (typeof record.idField !== "string") return false;
  if (!Array.isArray(record.ids)) return false;
  if (typeof record.map !== "object" || record.map === null || Array.isArray(record.map)) {
    return false;
  }
  if (
    typeof record.refsCount !== "object" ||
    record.refsCount === null ||
    Array.isArray(record.refsCount)
  ) {
    return false;
  }

  for (const itemKey of Object.keys(item)) {
    if (!collectionFieldsSet.has(itemKey)) {
      return false;
    }
  }

  return true;
};

// Path keys are built incrementally from length-prefixed segments (so a property
// name embedding the separator cannot collide with a genuine nested path), and
// tracking proxies are cached per (raw target, path key) in a per-selector context
// so unchanged subtrees reuse their proxies across recomputes instead of
// rebuilding the whole proxy tree and re-stringifying full paths on every access.
const pathKeySeparator = "\u0001";

export interface TrackingContext {
  accessedPaths: Set<string>;
  readonly parsedPaths: Map<string, AccessedPath>;
  readonly proxyCache: WeakMap<object, Map<string, object>>;
}

export const createTrackingContext = (
  parsedPaths: Map<string, AccessedPath>
): TrackingContext => ({
  accessedPaths: new Set(),
  parsedPaths,
  proxyCache: new WeakMap(),
});

export const createTrackingProxy = <T>(
  target: T,
  context: TrackingContext,
  pathKey = "",
  currentPath: AccessedPath = []
): T => {
  if (target === null || target === undefined || typeof target !== "object") {
    return target;
  }

  const rawTarget = getRawValue(target) as object;
  let proxiesByPath = context.proxyCache.get(rawTarget);
  if (proxiesByPath) {
    const cachedProxy = proxiesByPath.get(pathKey);
    if (cachedProxy) {
      return cachedProxy as T;
    }
  } else {
    proxiesByPath = new Map();
    context.proxyCache.set(rawTarget, proxiesByPath);
  }

  const proxy = new Proxy(rawTarget, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop);
      if (!prop) {
        return value;
      }

      if (typeof prop === "string" && collectionFieldsSet.has(prop) && isCollectionLike(obj)) {
        return value;
      }

      const segment = typeof prop === "symbol" ? String(prop) : prop;
      const encodedSegment = segment.length + ":" + segment;
      const pathString =
        pathKey === "" ? encodedSegment : pathKey + pathKeySeparator + encodedSegment;
      let newPath = context.parsedPaths.get(pathString);
      if (!newPath) {
        newPath = [...currentPath, prop];
        context.parsedPaths.set(pathString, newPath);
      }
      context.accessedPaths.add(pathString);

      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !isCollectionLike(value)
      ) {
        return createTrackingProxy(value, context, pathString, newPath);
      }

      return value;
    },
  });

  proxyValuesWeakMap.set(proxy, rawTarget);
  proxiesByPath.set(pathKey, proxy);

  return proxy as T;
};

const isValueChangedAtPath = <STATE>(
  prevState: STATE,
  nextState: STATE,
  path: AccessedPath
): boolean => {
  let currentPrev: any = prevState;
  let currentNext: any = nextState;

  for (const key of path) {
    currentPrev = currentPrev ? currentPrev[key] : undefined;
    currentNext = currentNext ? currentNext[key] : undefined;
    if (currentPrev === currentNext) {
      return false;
    }
  }

  return true;
};

export const hasStateChanged = <STATE>(
  oldState: STATE,
  newState: STATE,
  accessedPaths: Set<string>,
  parsedPaths: Map<string, AccessedPath>,
  changedAccessedPaths?: Set<string>
): boolean => {
  let stateChanged = false;
  for (const pathStr of accessedPaths) {
    const path = parsedPaths.get(pathStr);
    if (!path) {
      continue;
    }

    if (isValueChangedAtPath(oldState, newState, path)) {
      if (!changedAccessedPaths) {
        return true;
      }
      changedAccessedPaths.add(pathStr);
      stateChanged = true;
    }
  }

  return stateChanged;
};

const getArgumentType = (args: readonly unknown[], position: number): string => {
  if (position >= args.length) return "missing";
  const argument = args[position];
  if (argument === null) return "null";
  if (Array.isArray(argument)) return "array";
  return typeof argument;
};

const getChangedArguments = (
  previousArgs: readonly unknown[],
  currentArgs: readonly unknown[]
): SelectorArgumentChange[] => {
  const changes: SelectorArgumentChange[] = [];
  const argumentCount = Math.max(previousArgs.length, currentArgs.length);
  for (let position = 0; position < argumentCount; position += 1) {
    if (
      position < previousArgs.length &&
      position < currentArgs.length &&
      Object.is(previousArgs[position], currentArgs[position])
    ) {
      continue;
    }
    changes.push({
      position,
      previousType: getArgumentType(previousArgs, position),
      currentType: getArgumentType(currentArgs, position),
    });
  }
  return changes;
};

export const createCachedSelector = <STATE, ARGS extends unknown[] = [], R = undefined>(
  selectorFunc: CachedSelector<STATE, R, ARGS>,
  options?: CreateCachedSelectorOptions<STATE, R, ARGS>
): CachedSelector<STATE, R, ARGS> => {
  const traceReporter = options?.traceReporter;
  const hasExplicitTraceCategories =
    options?.traceExecution !== undefined ||
    options?.traceInvalidation !== undefined ||
    options?.traceArguments !== undefined ||
    options?.traceResults !== undefined;
  const traceExecution = Boolean(
    traceReporter && (options?.traceExecution ?? !hasExplicitTraceCategories)
  );
  const traceInvalidation = Boolean(traceReporter && options?.traceInvalidation);
  const traceArguments = Boolean(traceReporter && options?.traceArguments);
  const traceResults = Boolean(traceReporter && options?.traceResults);
  const traceState = traceReporter ? { recomputationCount: 0 } : undefined;
  let previousSelectResult: { value: R } | undefined = undefined;
  let previousArgs: ARGS | undefined = undefined;
  let previousState: STATE | undefined = undefined;
  let accessedPaths: Set<string> = new Set();
  const parsedPaths = new Map<string, AccessedPath>();
  const trackingContext = createTrackingContext(parsedPaths);

  return (state: STATE, ...args: ARGS): R => {
    const rawValue = getRawValue(state);
    if (options?.lockUpdatesPredicate?.(rawValue) && previousSelectResult !== undefined) {
      return previousSelectResult.value;
    }

    const firstExecution = previousArgs === undefined;
    const argsChanged = firstExecution || !shallowEqual(args, previousArgs);
    const changedAccessedPaths =
      traceInvalidation && !argsChanged && previousState
        ? new Set<string>()
        : undefined;
    const stateChanged =
      !argsChanged && previousState
        ? hasStateChanged(
            previousState,
            rawValue,
            accessedPaths,
            parsedPaths,
            changedAccessedPaths
          )
        : true;

    if (!argsChanged && !stateChanged && previousSelectResult !== undefined) {
      previousState = rawValue;
      return previousSelectResult.value;
    }

    if (rawValue !== state) {
      const result = selectorFunc(state, ...args);
      previousArgs = args;
      previousSelectResult = { value: result };
      return result;
    }

    const newAccessedPaths = new Set<string>();
    trackingContext.accessedPaths = newAccessedPaths;
    const trackedState = createTrackingProxy(state, trackingContext);
    const executionStartedAt = traceExecution ? performance.now() : undefined;
    const maybeProxyResult = selectorFunc(trackedState, ...args);
    const result = getRawValue(maybeProxyResult);
    const executionDurationMs =
      executionStartedAt === undefined ? undefined : performance.now() - executionStartedAt;
    const previousResult = previousSelectResult;
    const retainedPreviousReference =
      previousResult !== undefined && shallowEqual(previousResult.value, result);
    const finalResult: R = retainedPreviousReference ? previousResult.value : result;

    if (traceState) {
      traceState.recomputationCount += 1;
      const invalidationReason: SelectorInvalidationReason | undefined = traceInvalidation
        ? firstExecution
          ? "first-execution"
          : argsChanged
            ? "selector-arguments-changed"
            : stateChanged
              ? "accessed-state-paths-changed"
              : "previous-result-unavailable"
        : undefined;
      const resultOutcome: SelectorResultOutcome | undefined = traceResults
        ? firstExecution
          ? "initial"
          : retainedPreviousReference
            ? "retained-reference"
            : "changed"
        : undefined;
      const argumentPropertyKeys = getArgumentPropertyKeys(args);
      const redactedAccessedPathMetadata = redactAccessedPathMetadata(
        traceExecution ? newAccessedPaths : undefined,
        parsedPaths,
        argumentPropertyKeys
      );
      const redactedChangedPathMetadata = redactAccessedPathMetadata(
        traceInvalidation ? changedAccessedPaths : undefined,
        parsedPaths,
        argumentPropertyKeys
      );
      const traceParsedPaths = new Map([
        ...redactedAccessedPathMetadata.parsedPaths,
        ...redactedChangedPathMetadata.parsedPaths,
      ]);
      traceReporter?.({
        selectorFunc,
        recomputationCount: traceState.recomputationCount,
        ...(traceExecution
          ? {
              accessedPathCount: redactedAccessedPathMetadata.accessedPaths.size,
              accessedPaths: redactedAccessedPathMetadata.accessedPaths,
              parsedPaths: traceParsedPaths,
              executionDurationMs,
            }
          : {}),
        ...(traceInvalidation
          ? {
              invalidationReason,
              changedAccessedPaths: changedAccessedPaths
                ? redactedChangedPathMetadata.accessedPaths
                : undefined,
              parsedPaths: traceParsedPaths,
            }
          : {}),
        ...(traceArguments
          ? {
              argumentsChanged: !firstExecution && argsChanged,
              changedArguments:
                !firstExecution && argsChanged && previousArgs
                  ? getChangedArguments(previousArgs, args)
                  : [],
            }
          : {}),
        ...(traceResults ? { resultOutcome } : {}),
      });
    }

    previousSelectResult = { value: finalResult };
    previousArgs = args;
    previousState = rawValue;
    accessedPaths = newAccessedPaths;

    return finalResult;
  };
};