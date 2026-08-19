import { afterEach, describe, expect, it, vi } from "vitest";
import type { Middleware } from "redux";
import { normalizeStoreOptions } from './store-options';
import { createLoggerMiddleware } from './redux-logger';

afterEach(() => {
  vi.unstubAllGlobals();
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

  it('logs action titles, preserves dispatch results, and computes changed state lazily', () => {
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const end = vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
    let state: any = { todos: { items: ['before'] }, untouched: true };
    const middleware = createLoggerMiddleware()({
      getState: () => state,
      dispatch: (action: any) => action,
    } as any)((action: any) => {
      state = { todos: { items: ['after'] }, untouched: true };
      return { result: action.type };
    });

    const result = middleware({ type: 'todos/set', payload: 'after' });

    expect(result).toEqual({ result: 'todos/set' });
    expect(group).toHaveBeenCalledWith('%ctodos/set after', 'color: inherit; font-weight: 600');
    const changedPayload = log.mock.calls.find((call) => String(call[0]).includes(' state    '))?.[2] as any;
    expect(changedPayload).toBeDefined();
    expect('changes' in changedPayload).toBe(true);
    expect(changedPayload.changes).toEqual({ 'todos.items[0]': { prev: 'before', next: 'after' } });
    expect(info).not.toHaveBeenCalled();
    end.mockRestore();
    group.mockRestore();
    info.mockRestore();
    log.mockRestore();
  });

  it('renders unchanged state with the gray no-changes record and omits complex payloads', () => {
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const end = vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
    const state = { value: 1 };
    const middleware = createLoggerMiddleware()({ getState: () => state, dispatch: (a: any) => a } as any)(
      (action: any) => action
    );

    middleware({ type: 'noop', payload: { nested: true } });

    expect(group).toHaveBeenCalledWith('%cnoop', 'color: #9E9E9E; font-weight: 300');
    expect(log).toHaveBeenCalledWith(
      '%c state (no changes)',
      'color: #9E9E9E; font-weight: lighter',
      { state }
    );
    end.mockRestore();
    group.mockRestore();
    log.mockRestore();
  });
});
