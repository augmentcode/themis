import { describe, expect, it, vi } from "vitest";
import { getOrCreate } from "./selector-output-cache";

const getGarbageCollector = (): (() => void) | undefined =>
  (globalThis as typeof globalThis & { gc?: () => void }).gc;

const itWithGarbageCollector =
  typeof WeakRef === "function" && getGarbageCollector() ? it : it.skip;

const waitForGarbageCollection = async (ref: WeakRef<object>): Promise<void> => {
  const gc = getGarbageCollector();
  if (!gc) return;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    gc();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (ref.deref() === undefined) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};

const createWeakArgumentProbe = () => {
  const source = { name: "source" };
  const selector = (_state: unknown, arg: object) => arg;
  const arg = { id: "item-1" };
  const argRef = new WeakRef<object>(arg);

  expect(getOrCreate(source, selector, [arg], () => "cached output")).toBe("cached output");

  return { argRef, selector, source };
};

describe("selector output cache", () => {
  it("returns the cached output for the same state source, selector function, and argument identities", () => {
    const source = { name: "source" };
    const selector = (_state: unknown, arg: object) => arg;
    const arg = { id: "item-1" };
    const output = { value: "selected" };
    const factory = vi.fn(() => output);

    expect(getOrCreate(source, selector, [arg], factory)).toBe(output);
    expect(getOrCreate(source, selector, [arg], () => ({ value: "other" }))).toBe(output);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("traces cache requests without increasing cached count on hits", () => {
    const source = { name: "trace-source" };
    const selector = (_state: unknown, arg: object) => arg;
    const arg = { id: "item-1" };
    const output = { value: "selected" };
    const factory = vi.fn(() => output);
    const traceReporter = vi.fn();

    expect(getOrCreate(source, selector, [arg], factory, { traceReporter })).toBe(output);
    expect(getOrCreate(source, selector, [arg], () => ({ value: "other" }), { traceReporter })).toBe(output);
    expect(factory).toHaveBeenCalledTimes(1);
    const firstTrace = traceReporter.mock.calls[0][0];
    const secondTrace = traceReporter.mock.calls[1][0];
    expect(secondTrace.observableCacheRequestCount).toBe(firstTrace.observableCacheRequestCount + 1);
    expect(secondTrace.observableCacheCachedCount).toBe(firstTrace.observableCacheCachedCount);
    expect(firstTrace.selectorFunc).toBe(selector);
  });

  it("traces cache counts independently per selector function", () => {
    const source = { name: "trace-source" };
    const selectorA = (_state: unknown, arg: object) => arg;
    const selectorB = (_state: unknown, arg: object) => arg;
    const arg = { id: "item-1" };
    const outputA = { value: "selected-a" };
    const outputB = { value: "selected-b" };
    const factoryA = vi.fn(() => outputA);
    const factoryB = vi.fn(() => outputB);
    const traceReporter = vi.fn();

    expect(getOrCreate(source, selectorA, [arg], factoryA, { traceReporter })).toBe(outputA);
    expect(getOrCreate(source, selectorA, [arg], () => ({ value: "other-a" }), { traceReporter })).toBe(
      outputA
    );
    expect(getOrCreate(source, selectorB, [arg], factoryB, { traceReporter })).toBe(outputB);
    expect(getOrCreate(source, selectorA, [arg], () => ({ value: "miss-a" }), { traceReporter })).toBe(
      outputA
    );

    expect(factoryA).toHaveBeenCalledTimes(1);
    expect(factoryB).toHaveBeenCalledTimes(1);
    const [firstA, secondA, firstB, thirdA] = traceReporter.mock.calls.map(([trace]) => trace);
    expect(firstA).toEqual(
      expect.objectContaining({
        selectorFunc: selectorA,
        observableCacheRequestCount: 1,
        observableCacheCachedCount: 1,
      })
    );
    expect(secondA).toEqual(
      expect.objectContaining({
        selectorFunc: selectorA,
        observableCacheRequestCount: 2,
        observableCacheCachedCount: 1,
      })
    );
    expect(firstB).toEqual(
      expect.objectContaining({
        selectorFunc: selectorB,
        observableCacheRequestCount: 1,
        observableCacheCachedCount: 1,
      })
    );
    expect(thirdA).toEqual(
      expect.objectContaining({
        selectorFunc: selectorA,
        observableCacheRequestCount: 3,
        observableCacheCachedCount: 1,
      })
    );
  });

  it("separates outputs by state source, selector function, and argument identity", () => {
    const sourceA = { name: "source-a" };
    const sourceB = { name: "source-b" };
    const selectorA = (_state: unknown, arg: object) => arg;
    const selectorB = (_state: unknown, arg: object) => arg;
    const argA = { id: "item-1" };
    const argB = { id: "item-1" };
    const outputA = { name: "A" };
    const outputB = { name: "B" };
    const outputC = { name: "C" };

    expect(getOrCreate(sourceA, selectorA, [argA], () => outputA)).toBe(outputA);
    expect(getOrCreate(sourceA, selectorB, [argA], () => outputB)).toBe(outputB);
    expect(getOrCreate(sourceA, selectorA, [argB], () => outputC)).toBe(outputC);
    expect(getOrCreate(sourceB, selectorA, [argA], () => ({ name: "D" }))).not.toBe(outputA);
  });

  it("keeps primitive selector arguments cacheable without collisions", () => {
    const source = { name: "source" };
    const selector = (_state: unknown, ...args: unknown[]) => args;
    const symbolArg = Symbol("arg");
    const output = { value: "primitive path" };

    expect(
      getOrCreate(source, selector, ["id", 1, true, null, undefined, 1n, symbolArg], () => output)
    ).toBe(output);
    expect(
      getOrCreate(source, selector, ["id", 1, true, null, undefined, 1n, symbolArg], () => ({ value: "miss" }))
    ).toBe(output);
    expect(getOrCreate(source, selector, ["id", 1, false], () => ({ value: "different" }))).not.toBe(
      output
    );
  });

  it("treats selector argument order as part of the cache path", () => {
    const source = { name: "source" };
    const selector = (_state: unknown, ...args: unknown[]) => args;
    const arg = { id: "item-1" };
    const first = { order: "object-first" };
    const second = { order: "primitive-first" };

    expect(getOrCreate(source, selector, [arg, "suffix"], () => first)).toBe(first);
    expect(getOrCreate(source, selector, ["suffix", arg], () => second)).toBe(second);
  });

  itWithGarbageCollector("does not strongly retain object selector arguments", async () => {
    const probe = createWeakArgumentProbe();

    await waitForGarbageCollection(probe.argRef);

    expect(probe.argRef.deref()).toBeUndefined();
    expect(getOrCreate(probe.source, probe.selector, [{}], () => "other output")).toBe("other output");
  });
});