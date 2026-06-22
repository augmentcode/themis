import { describe, expect, it } from "vitest";
import { createAction, createAsyncAction } from "./create-action";

describe("createAction", () => {
  it("creates tuple payload actions and exposes a stable type", () => {
    const setName = createAction<[id: string, name: string]>("user/setName");

    expect(setName.type).toBe("user/setName");
    expect(setName.toString()).toBe("user/setName");
    expect(setName("u1", "Ada")).toEqual({
      type: "user/setName",
      payload: ["u1", "Ada"],
    });
  });

  it("uses payload modifiers as the public payload shape", () => {
    const rename = createAction(
      "user/rename",
      (id: string, name: string) => ({ id, name })
    );

    expect(rename("u1", "Ada")).toEqual({
      type: "user/rename",
      payload: { id: "u1", name: "Ada" },
    });
  });
});

describe("createAsyncAction", () => {
  it("creates a request action with captured success payload", async () => {
    const loadUser = createAsyncAction<[id: string], { id: string }, { name: string }>(
      "user/loadAsync",
      "user/load",
      (id) => ({ id })
    );

    const request = loadUser("u1");
    const resolution = expect(request.promise).resolves.toEqual({ name: "Ada" });

    expect(loadUser.type).toBe("user/load");
    expect(loadUser.asyncActionType).toBe("user/loadAsync");
    expect(request.type).toBe("user/load");
    expect(request.asyncActionType).toBe("user/loadAsync");
    expect(request.payload).toEqual({ id: "u1" });
    expect(request.success({ name: "Ada" })).toEqual({
      type: "user/load_SUCCESS",
      payload: {
        request: { id: "u1" },
        response: { name: "Ada" },
      },
    });
    await resolution;
  });

  it("creates captured failure actions that reject the request promise", async () => {
    const loadUser = createAsyncAction<[id: string], { id: string }, { name: string }>(
      "user/loadAsync",
      "user/load",
      (id) => ({ id })
    );
    const request = loadUser("u1");
    const error = new Error("boom");
    const rejection = expect(request.promise).rejects.toBe(error);

    expect(request.failure(error)).toEqual({
      type: "user/load_FAILURE",
      payload: {
        request: { id: "u1" },
        error,
      },
    });
    await rejection;
  });

  it("exposes static success and failure action creators", () => {
    const loadUser = createAsyncAction<[id: string], { id: string }, { name: string }>(
      "user/loadAsync",
      "user/load",
      (id) => ({ id })
    );
    const error = new Error("boom");

    expect(loadUser.success({ name: "Ada" })).toEqual({
      type: "user/load_SUCCESS",
      payload: { request: undefined, response: { name: "Ada" } },
    });
    expect(loadUser.failure(error)).toEqual({
      type: "user/load_FAILURE",
      payload: { request: undefined, error },
    });
  });
});