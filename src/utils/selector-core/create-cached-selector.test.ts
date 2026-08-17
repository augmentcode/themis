import { describe, expect, it, vi } from "vitest";
import { createCachedSelector, renderAccessedPaths } from "./create-cached-selector";

const allTraceCategories = {
  traceExecution: true,
  traceInvalidation: true,
  traceArguments: true,
  traceResults: true,
};

describe("createCachedSelector tracing", () => {
  it("redacts identifier-like and non-identifier selector argument keys from path metadata", () => {
    const traceReporter = vi.fn();
    const selector = createCachedSelector(
      (state: { records: Record<string, { name: string }> }, key: string) =>
        state.records[key]?.name,
      { traceReporter, traceExecution: true, traceInvalidation: true }
    );

    selector({ records: { privateKey: { name: "A" } } }, "privateKey");
    selector({ records: { "private key": { name: "B" } } }, "private key");
    selector({ records: { "private key": { name: "C" } } }, "private key");

    for (const [trace] of traceReporter.mock.calls) {
      const serializedMetadata = JSON.stringify({
        accessedPaths: Array.from(trace.accessedPaths),
        changedAccessedPaths: Array.from(trace.changedAccessedPaths ?? []),
        parsedPaths: Array.from(trace.parsedPaths),
      });
      expect(serializedMetadata).not.toContain("privateKey");
      expect(serializedMetadata).not.toContain("private key");
      expect(renderAccessedPaths(trace.accessedPaths, trace.parsedPaths)).toEqual([
        "records",
        'records["<selector-argument>"]',
        'records["<selector-argument>"].name',
      ]);
    }
    const changedTrace = traceReporter.mock.calls[2][0];
    expect(renderAccessedPaths(changedTrace.changedAccessedPaths, changedTrace.parsedPaths)).toEqual([
      "records",
      'records["<selector-argument>"]',
      'records["<selector-argument>"].name',
    ]);
  });

  it("reports safe invalidation, argument, path, and result metadata", () => {
    const traceReporter = vi.fn();
    const firstArg = { id: "first" };
    const secondArg = { id: "second" };
    const selected = { count: 1 };
    const selector = createCachedSelector<
      { selected: { count: number }; ignored: number },
      [object, number],
      { parity: number }
    >(
      (state) => ({ parity: state.selected.count % 2 }),
      { traceReporter, ...allTraceCategories }
    );

    const firstResult = selector({ selected, ignored: 0 }, firstArg, 1);
    const unchangedResult = selector({ selected, ignored: 1 }, firstArg, 1);
    const reusedResult = selector({ selected, ignored: 2 }, secondArg, 2);
    const changedResult = selector({ selected: { count: 2 }, ignored: 3 }, secondArg, 2);

    expect(unchangedResult).toBe(firstResult);
    expect(reusedResult).toBe(firstResult);
    expect(changedResult).not.toBe(firstResult);
    expect(traceReporter).toHaveBeenCalledTimes(3);
    const [firstTrace, argumentTrace, stateTrace] = traceReporter.mock.calls.map(([trace]) => trace);
    expect(firstTrace).toEqual(expect.objectContaining({
      invalidationReason: "first-execution",
      argumentsChanged: false,
      changedArguments: [],
      resultOutcome: "initial",
    }));
    expect(argumentTrace).toEqual(expect.objectContaining({
      invalidationReason: "selector-arguments-changed",
      argumentsChanged: true,
      changedArguments: [
        { position: 0, previousType: "object", currentType: "object" },
        { position: 1, previousType: "number", currentType: "number" },
      ],
      resultOutcome: "retained-reference",
    }));
    expect(stateTrace).toEqual(expect.objectContaining({
      invalidationReason: "accessed-state-paths-changed",
      argumentsChanged: false,
      changedArguments: [],
      resultOutcome: "changed",
    }));
    expect(Array.from(stateTrace.changedAccessedPaths)).toEqual([
      '["selected"]',
      '["selected","count"]',
    ]);
    for (const trace of [firstTrace, argumentTrace, stateTrace]) {
      expect(trace).not.toHaveProperty("args");
      expect(trace).not.toHaveProperty("result");
      expect(trace).not.toHaveProperty("state");
    }
  });

  it("gates category metadata and timing independently", () => {
    const invalidationReporter = vi.fn();
    const argumentsReporter = vi.fn();
    const resultsReporter = vi.fn();
    const now = vi.spyOn(performance, "now");
    const invalidationSelector = createCachedSelector(
      (state: { count: number }) => state.count,
      { traceReporter: invalidationReporter, traceExecution: false, traceInvalidation: true }
    );
    const argumentsSelector = createCachedSelector(
      (_state: {}, arg: object) => 1,
      { traceReporter: argumentsReporter, traceExecution: false, traceArguments: true }
    );
    const resultsSelector = createCachedSelector(
      (state: { count: number }) => ({ count: state.count }),
      { traceReporter: resultsReporter, traceExecution: false, traceResults: true }
    );

    invalidationSelector({ count: 1 });
    const firstArg = {};
    argumentsSelector({}, firstArg);
    argumentsSelector({}, {});
    resultsSelector({ count: 1 });

    expect(now).not.toHaveBeenCalled();
    expect(invalidationReporter.mock.calls[0][0]).toEqual(expect.objectContaining({
      invalidationReason: "first-execution",
    }));
    expect(invalidationReporter.mock.calls[0][0]).not.toHaveProperty("argumentsChanged");
    expect(argumentsReporter.mock.calls[1][0]).toEqual(expect.objectContaining({
      argumentsChanged: true,
      changedArguments: [{ position: 0, previousType: "object", currentType: "object" }],
    }));
    expect(argumentsReporter.mock.calls[1][0]).not.toHaveProperty("invalidationReason");
    expect(resultsReporter.mock.calls[0][0]).toEqual(expect.objectContaining({
      resultOutcome: "initial",
    }));
    expect(resultsReporter.mock.calls[0][0]).not.toHaveProperty("executionDurationMs");
  });

  it("reports recomputation when an undefined result cannot be retained", () => {
    const traceReporter = vi.fn();
    const selector = createCachedSelector(
      (_state: { count: number }) => undefined,
      { traceReporter, traceExecution: false, traceInvalidation: true, traceResults: true }
    );

    selector({ count: 1 });
    selector({ count: 1 });

    expect(traceReporter.mock.calls.map(([trace]) => trace)).toEqual([
      expect.objectContaining({ invalidationReason: "first-execution", resultOutcome: "initial" }),
      expect.objectContaining({
        invalidationReason: "previous-result-unavailable",
        resultOutcome: "changed",
      }),
    ]);
  });

  it("does no tracing work when no reporter is configured", () => {
    const now = vi.spyOn(performance, "now");
    const select = vi.fn((state: { count: number }) => state.count);
    const selector = createCachedSelector(select);

    selector({ count: 1 });
    selector({ count: 1 });

    expect(select).toHaveBeenCalledTimes(1);
    expect(now).not.toHaveBeenCalled();
  });
});