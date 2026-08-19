import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "./svelte-store";
import { cleanUpGlobalDevTools, registerGlobalDevTools } from "./global-dev-tools";

vi.mock("./utils/runtime-svelte/utils", () => ({
  getStoreContext: vi.fn(() => undefined),
  getDispatch: vi.fn(),
}));

const getSvelteRedux = () => (window as any).svelteRedux;

const stubBrowserGlobals = () => {
  vi.stubGlobal("window", {});
};

describe("global devtools registration", () => {
  beforeEach(() => {
    stubBrowserGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers a Store instance", () => {
    const store = new Store();

    registerGlobalDevTools(store);

    expect(Object.keys(window)).toEqual(["svelteRedux"]);
    expect(Object.keys(getSvelteRedux())).toEqual(["reduxContext"]);
    expect(getSvelteRedux().reduxContext).toBe(store);
  });

  it("ignores duplicate registration and reports multiple stores", () => {
    const reportRuntimeError = vi.fn();
    const firstStore = new Store();
    const secondStore = new Store();

    registerGlobalDevTools(firstStore);
    registerGlobalDevTools(firstStore);
    registerGlobalDevTools(secondStore, reportRuntimeError);

    expect(getSvelteRedux().reduxContext).toEqual([firstStore, secondStore]);
    expect(reportRuntimeError).toHaveBeenCalledWith({
      error: expect.any(Error),
      source: "global-dev-tools",
      message: "Multiple Redux stores initialized:",
      payload: [firstStore, secondStore],
    });
  });

  it("cleans up the matching global Store registration", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const firstStore = new Store();
    const secondStore = new Store();

    const cleanUpSingle = registerGlobalDevTools(firstStore);
    cleanUpSingle();
    expect(getSvelteRedux().reduxContext).toBeUndefined();

    const cleanUpFirst = registerGlobalDevTools(firstStore);
    registerGlobalDevTools(secondStore);
    cleanUpFirst();
    expect(getSvelteRedux().reduxContext).toEqual([secondStore]);

    cleanUpGlobalDevTools(secondStore);
    expect(getSvelteRedux().reduxContext).toEqual([]);
  });

  it("does not implicitly register devtools during init", () => {
    const reducer = (state = { value: 0 }) => state;
    const store = new Store({ counter: reducer });

    const dispose = store.init();

    expect(getSvelteRedux()).toBeUndefined();
    dispose();
  });
});