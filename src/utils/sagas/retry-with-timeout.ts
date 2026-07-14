import { call, delay, race } from "typed-redux-saga";
import type { RetryWithTimeoutOptions, RetryWithTimeoutOutcome } from "../types";

export type { RetryWithTimeoutOptions, RetryWithTimeoutOutcome } from "../types";

export function* retryWithTimeout(
  fn: () => Generator<any, unknown, any>,
  options: RetryWithTimeoutOptions
): Generator<any, RetryWithTimeoutOutcome, any> {
  const {
    maxRetries: rawMaxRetries,
    timeoutMs,
    getDelayMs = (attempt: number) => 1000 * (attempt + 1),
    onAttemptError,
  } = options;
  const maxRetries = Math.max(0, rawMaxRetries);
  const totalAttempts = maxRetries + 1;

  const result = yield* race({
    outcome: call(function* (): Generator<any, RetryWithTimeoutOutcome, any> {
      for (let attempt = 0; attempt < totalAttempts; attempt++) {
        try {
          yield* call(fn);
          return "success";
        } catch (error) {
          try {
            onAttemptError?.(error, attempt, totalAttempts);
          } catch {
            // Do not let observer errors abort the retry loop.
          }
          if (attempt < maxRetries) {
            yield* delay(getDelayMs(attempt));
          }
        }
      }
      return "retries-exhausted";
    }),
    timeout: delay(timeoutMs),
  });

  return result.outcome ?? "timeout";
}
