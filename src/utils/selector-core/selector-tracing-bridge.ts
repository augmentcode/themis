import type {
  SelectorComputationTraceOptions,
  SelectorTraceReporter,
} from "../types";

type SelectorTracingBridge = {
  getComputationTraceOptions<STATE, R, ARGS extends unknown[]>():
    | SelectorComputationTraceOptions<STATE, R, ARGS>
    | undefined;
  getCacheTraceReporter<STATE, R, ARGS extends unknown[]>():
    | SelectorTraceReporter<STATE, R, ARGS>
    | undefined;
};

const bridgeByStateSource = new WeakMap<object, SelectorTracingBridge>();

export const registerSelectorTracingBridge = (
  stateSource: object,
  bridge: SelectorTracingBridge
): void => {
  bridgeByStateSource.set(stateSource, bridge);
};

export const getSelectorComputationTraceOptions = <
  STATE,
  R,
  ARGS extends unknown[],
>(stateSource: object): SelectorComputationTraceOptions<STATE, R, ARGS> | undefined =>
  bridgeByStateSource.get(stateSource)?.getComputationTraceOptions<STATE, R, ARGS>();

export const getSelectorCacheTraceReporter = <
  STATE,
  R,
  ARGS extends unknown[],
>(stateSource: object): SelectorTraceReporter<STATE, R, ARGS> | undefined =>
  bridgeByStateSource.get(stateSource)?.getCacheTraceReporter<STATE, R, ARGS>();