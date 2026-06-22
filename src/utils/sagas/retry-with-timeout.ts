import { call, delay, race } from "typed-redux-saga";

export type RetryWithTimeoutOutcome = "success" | "retries-exhausted" | "timeout";

export interface RetryWithTimeoutOptions {
  /** Maximum number of retries. Total attempts = maxRetries + 1. */
  maxRetries: number;
  /** Overall timeout in milliseconds for all attempts and retry delays combined. */
  timeoutMs: number;
  /** Delay before retrying after a failed attempt. Defaults to progressive 1s, 2s, ... delays. */
  getDelayMs?: (attempt: number) => number;
  /** Called after each failed attempt. Callback errors are swallowed so retries can continue. */
  onAttemptError?: (error: unknown, attempt: number, totalAttempts: number) => void;
}

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
