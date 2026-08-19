import { describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import { lockReactiveSelectors } from "./lock-reactive-selectors";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../../../constants";

describe("lockReactiveSelectors diagnostics", () => {
  it("reports handler errors through saga context before rethrowing", async () => {
    const error = new Error("handler boom");
    const reportRuntimeError = vi.fn();
    const dispatched: unknown[] = [];

    function* handler() {
      throw error;
    }

    await expect(
      runSaga(
        {
          context: { reportRuntimeError },
          dispatch: (action: unknown) => {
            dispatched.push(action);
            return action;
          },
          getState: () => ({
            [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: false },
          }),
        },
        lockReactiveSelectors,
        handler
      ).toPromise()
    ).rejects.toBe(error);

    expect(reportRuntimeError).toHaveBeenCalledWith({
      error,
      source: "lock-reactive-selectors",
    });
    expect(dispatched).toHaveLength(2);
  });
});