import { describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import { call } from "typed-redux-saga";
import { retryWithTimeout } from "./retry-with-timeout";

function runToCompletion<T>(saga: () => Generator<any, T, any>) {
  return runSaga({ dispatch: () => {}, getState: () => ({}) }, saga).toPromise();
}

describe("retryWithTimeout", () => {
  it("returns success when the function succeeds", async () => {
    const fn = vi.fn();

    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(function* () {
        fn();
      }, { maxRetries: 2, timeoutMs: 5_000 });
    });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries failures and reports observer errors without aborting", async () => {
    let attempts = 0;
    const onAttemptError = vi.fn(() => {
      throw new Error("observer failed");
    });

    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(function* () {
        attempts++;
        if (attempts < 3) throw new Error("attempt failed");
      }, { maxRetries: 2, timeoutMs: 5_000, getDelayMs: () => 1, onAttemptError });
    });

    expect(result).toBe("success");
    expect(attempts).toBe(3);
    expect(onAttemptError).toHaveBeenCalledTimes(2);
  });

  it("returns retries-exhausted when all attempts fail", async () => {
    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(function* () {
        throw new Error("always fails");
      }, { maxRetries: 1, timeoutMs: 5_000, getDelayMs: () => 1 });
    });

    expect(result).toBe("retries-exhausted");
  });

  it("returns timeout when the overall timeout wins", async () => {
    const result = await runToCompletion(function* () {
      return yield* retryWithTimeout(function* () {
        yield* call(() => new Promise(() => {}));
      }, { maxRetries: 0, timeoutMs: 10 });
    });

    expect(result).toBe("timeout");
  });
});
