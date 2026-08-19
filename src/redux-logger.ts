import type { ReduxActionTraceEvent, StoreMiddleware } from './types';

export function createLoggerMiddleware(
  publish: (event: ReduxActionTraceEvent) => void
): StoreMiddleware {
  return (storeApi) => (next) => (action) => {
    const prevState = storeApi.getState();
    const result = next(action);
    const nextState = storeApi.getState();
    publish(Object.freeze({ action, prevState, nextState, stateChanged: prevState !== nextState }));
    return result;
  };
}