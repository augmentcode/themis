import { shallowEqual } from "fast-equals";
import { omitKey } from "../runtime/utils";

type DomainScopedState<T> = {
  byDomainId: Record<string, T>;
};

export function createDomainScopedHelpers<T>(emptyState: T) {
  const getDomainState = <S extends DomainScopedState<T>>(state: S, domainId: string): T => {
    return state.byDomainId[domainId] ?? emptyState;
  };

  const setDomainState = <S extends DomainScopedState<T>>(
    state: S,
    domainId: string,
    domainState: T
  ): S => {
    if (shallowEqual(state.byDomainId[domainId], domainState)) {
      return state;
    }

    return {
      ...state,
      byDomainId: {
        ...state.byDomainId,
        [domainId]: domainState,
      },
    };
  };

  const clearDomainState = <S extends DomainScopedState<T>>(state: S, domainId: string): S => {
    const byDomainId = omitKey(state.byDomainId, domainId);
    if (byDomainId === state.byDomainId) {
      return state;
    }

    return {
      ...state,
      byDomainId,
    };
  };

  return {
    getDomainState,
    setDomainState,
    clearDomainState,
  };
}

