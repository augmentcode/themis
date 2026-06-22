import { describe, expect, it, vi, beforeEach } from "vitest";
import { getContext } from "svelte";
import { getDispatch, getStoreContext } from "./utils";

vi.mock("svelte", () => ({
  getContext: vi.fn(),
}));

const mockedGetContext = vi.mocked(getContext);

describe("getStoreContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the store context from the Svelte component context", () => {
    const context = { store: { dispatch: vi.fn() } };
    mockedGetContext.mockReturnValue(context);

    expect(getStoreContext()).toBe(context);
  });

  it("returns undefined when no context exists", () => {
    mockedGetContext.mockReturnValue(undefined);

    expect(getStoreContext()).toBeUndefined();
  });

  it("adds guidance for Svelte lifecycle errors", () => {
    mockedGetContext.mockImplementation(() => {
      throw new Error("lifecycle_outside_component");
    });

    expect(() => getStoreContext()).toThrow("Store context accessed outside component initialization");
  });

  it("rethrows non-lifecycle errors", () => {
    const error = new Error("unexpected");
    mockedGetContext.mockImplementation(() => {
      throw error;
    });

    expect(() => getStoreContext()).toThrow(error);
  });
});

describe("getDispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns dispatch from Svelte store context", () => {
    const dispatch = vi.fn();
    mockedGetContext.mockReturnValue({ store: { dispatch } });

    expect(getDispatch()).toBe(dispatch);
  });

  it("throws when Store context is missing", () => {
    mockedGetContext.mockReturnValue(undefined);

    expect(() => getDispatch()).toThrow("Missing redux store context. Wrap root component into <Store/>");
  });

  it("adds getDispatch guidance for Svelte lifecycle errors", () => {
    mockedGetContext.mockImplementation(() => {
      throw new Error("lifecycle_outside_component");
    });

    expect(() => getDispatch()).toThrow("getDispatch() called outside component initialization");
  });

  it("rethrows non-lifecycle errors", () => {
    const error = new Error("unexpected");
    mockedGetContext.mockImplementation(() => {
      throw error;
    });

    expect(() => getDispatch()).toThrow(error);
  });
});
