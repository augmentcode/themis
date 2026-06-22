import { afterEach, describe, expect, it, vi } from "vitest";
import type { Middleware } from "redux";

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
});
