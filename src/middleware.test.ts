import { afterEach, describe, expect, it, vi } from "vitest";
import type { Middleware } from "redux";
import { normalizeStoreOptions } from './store-options';
import { createLoggerMiddleware } from './redux-logger';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("init middleware application", () => {
  it("applies provided middleware in order", async () => {
    const order: string[] = [];
    const createOrderedMiddleware = (name: string): Middleware =>
      () => (next) => (action) => {
        order.push(name);
        return next(action);
      };
    const constructorMiddleware = createOrderedMiddleware("constructor");
    const addedMiddleware = createOrderedMiddleware("added");
    const defaultMiddleware = createOrderedMiddleware("default");

    vi.doMock("./utils/runtime-svelte/utils", () => ({
      getStoreContext: vi.fn(() => undefined),
      getDispatch: vi.fn(),
    }));
    vi.doMock("redux-saga", () => ({
      default: vi.fn(() => Object.assign(
        () => (next: any) => (action: any) => next(action),
        { run: vi.fn(() => ({ cancel: vi.fn() })) }
      )),
    }));

    const { Store } = await import("./svelte-store");
    const store = new Store({ test: (state = {}) => state }, constructorMiddleware);
    store.addMiddleware([addedMiddleware, defaultMiddleware]);
    store.init();

    store.dispatch({ type: "TEST" });

    expect(order).toEqual(["constructor", "added", "default"]);
  });

  it('normalizes Redux logging to false by default and true when enabled', () => {
    expect(normalizeStoreOptions().logReduxActions).toBe(false);
    expect(normalizeStoreOptions({ logReduxActions: false }).logReduxActions).toBe(false);
    expect(normalizeStoreOptions({ logReduxActions: true }).logReduxActions).toBe(true);
  });

  it('publishes one immutable event after next and preserves its return value', () => {
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const end = vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
    const publish = vi.fn();
    let state: any = { todos: { items: ['before'] }, untouched: true };
    const prevState = state;
    const middleware = createLoggerMiddleware(publish)({
      getState: () => state,
      dispatch: (action: any) => action,
    } as any)((action: any) => {
      state = { todos: { items: ['after'] }, untouched: true };
      return { result: action.type };
    });

    const result = middleware({ type: 'todos/set', payload: 'after' });

    expect(result).toEqual({ result: 'todos/set' });
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith({
      action: { type: 'todos/set', payload: 'after' },
      prevState,
      nextState: state,
      stateChanged: true,
    });
    expect(Object.isFrozen(publish.mock.calls[0][0])).toBe(true);
    expect(group).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('publishes unchanged state and preserves next errors without publishing', () => {
    const publish = vi.fn();
    const state = { value: 1 };
    const middleware = createLoggerMiddleware(publish)(
      { getState: () => state, dispatch: (a: any) => a } as any
    )(
      (action: any) => action
    );

    middleware({ type: 'noop', payload: { nested: true } });

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ stateChanged: false }));

    const error = new Error('next failed');
    const failingPublish = vi.fn();
    const failingMiddleware = createLoggerMiddleware(failingPublish)(
      { getState: () => state, dispatch: (a: any) => a } as any
    )(() => {
      throw error;
    });
    expect(() => failingMiddleware({ type: 'fail' })).toThrow(error);
    expect(failingPublish).not.toHaveBeenCalled();
  });
});
