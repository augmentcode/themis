import { describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import { StreamTimeoutError, wrapStreamingGenerator } from "./wrap-async-generator";

function runToCompletion(saga: () => Generator<any, unknown, any>) {
  return runSaga({ dispatch: () => {}, getState: () => ({}) }, saga).toPromise();
}

describe("wrapStreamingGenerator", () => {
  it("emits yielded chunks and a non-null final return value", async () => {
    const events: string[] = [];

    async function* stream(): AsyncGenerator<string, string, unknown> {
      yield "a";
      yield "b";
      return "done";
    }

    await runToCompletion(function* () {
      yield* wrapStreamingGenerator(stream(), function* (chunk) {
        events.push(chunk);
      });
    });

    expect(events).toEqual(["a", "b", "done"]);
  });

  it("throws StreamTimeoutError when the timeout wins", async () => {
    async function* stream(): AsyncGenerator<string, undefined, unknown> {
      await new Promise(() => {});
      return undefined;
    }

    await expect(runToCompletion(function* () {
      yield* wrapStreamingGenerator(stream(), function* () {}, { timeoutMs: 10 });
    })).rejects.toBeInstanceOf(StreamTimeoutError);
  });

  it("reports stream errors through onError and rethrows the original error", async () => {
    const error = new Error("stream failed");
    const onError = vi.fn();

    async function* stream(): AsyncGenerator<string, undefined, unknown> {
      throw error;
    }

    await expect(runToCompletion(function* () {
      yield* wrapStreamingGenerator(stream(), function* () {}, { onError });
    })).rejects.toBe(error);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
