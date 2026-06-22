import { call, delay, race, type SagaGenerator } from "typed-redux-saga";

export class StreamTimeoutError extends Error {
  constructor(timeoutMs?: number) {
    super(timeoutMs === undefined ? "Stream timed out" : `Stream timed out after ${timeoutMs}ms`);
    this.name = "StreamTimeoutError";
  }
}

export interface WrapStreamingGeneratorOptions {
  timeoutMs?: number;
  onError?: (error: unknown) => void;
}

const normalizeOptions = (options?: number | WrapStreamingGeneratorOptions): WrapStreamingGeneratorOptions => {
  return typeof options === "number" ? { timeoutMs: options } : options ?? {};
};

export function* wrapStreamingGenerator<R>(
  generator: AsyncGenerator<R, R | null | undefined, unknown>,
  onEvent: (chunk: R) => Generator<any, any, any>,
  options?: number | WrapStreamingGeneratorOptions
): SagaGenerator<void> {
  const { timeoutMs, onError } = normalizeOptions(options);
  const next = (): Promise<IteratorResult<R, R | null | undefined>> => generator.next();

  function* streamLoop(): SagaGenerator<void> {
    let result = yield* call(next);
    while (result.done === false) {
      yield* onEvent(result.value);
      result = yield* call(next);
    }
    if (result.value !== undefined && result.value !== null) {
      yield* onEvent(result.value);
    }
  }

  try {
    if (timeoutMs === undefined) {
      yield* streamLoop();
      return;
    }

    const { timedOut } = yield* race({
      stream: call(streamLoop),
      timedOut: delay(timeoutMs),
    });
    if (timedOut) {
      throw new StreamTimeoutError(timeoutMs);
    }
  } catch (error) {
    try {
      onError?.(error);
    } catch {
      // Preserve the original stream error.
    }
    throw error;
  }
}
