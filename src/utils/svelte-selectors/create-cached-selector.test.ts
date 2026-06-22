import { describe, expect, it, vi } from "vitest";
import { createCachedSelector, createTrackingProxy, getRawValue } from "../selector-core/create-cached-selector";

type State = {
  locked: boolean;
  user: { name: string; age: number };
  unrelated: number;
};

const createState = (overrides: Partial<State> = {}): State => ({
  locked: false,
  user: { name: "Ada", age: 36 },
  unrelated: 0,
  ...overrides,
});

describe("createCachedSelector", () => {
  it("does not rerun when accessed state paths and args are unchanged", () => {
    const user = { name: "Ada", age: 36 };
    const selector = vi.fn((state: State, suffix: string) => `${state.user.name}${suffix}`);
    const cached = createCachedSelector<State, [string], string>(selector);

    expect(cached(createState({ user }), "!")).toBe("Ada!");
    expect(cached(createState({ user, unrelated: 1 }), "!")).toBe("Ada!");

    expect(selector).toHaveBeenCalledTimes(1);
  });

  it("reruns when args change", () => {
    const selector = vi.fn((state: State, suffix: string) => `${state.user.name}${suffix}`);
    const cached = createCachedSelector<State, [string], string>(selector);
    const state = createState();

    expect(cached(state, "!")).toBe("Ada!");
    expect(cached(state, "?")).toBe("Ada?");

    expect(selector).toHaveBeenCalledTimes(2);
  });

  it("reuses the previous result reference for shallow-equal outputs", () => {
    const selector = vi.fn((state: State) => ({ name: state.user.name }));
    const cached = createCachedSelector<State, [], { name: string }>(selector);

    const first = cached(createState());
    const second = cached(createState({ user: { name: "Ada", age: 37 } }));

    expect(second).toBe(first);
    expect(selector).toHaveBeenCalledTimes(2);
  });

  it("returns the last result while updates are locked", () => {
    const selector = vi.fn((state: State) => state.user.name);
    const cached = createCachedSelector<State, [], string>(selector, {
      lockUpdatesPredicate: (state) => state.locked,
    });

    expect(cached(createState())).toBe("Ada");
    expect(cached(createState({ locked: true, user: { name: "Grace", age: 37 } }))).toBe("Ada");

    expect(selector).toHaveBeenCalledTimes(1);
  });

  it("reports selector trace details after proxied evaluations only", () => {
    const user = { name: "Ada", age: 36 };
    const selector = vi.fn((state: State) => `${state.user.name}:${state.user.age}`);
    const traceReporter = vi.fn();
    const cached = createCachedSelector<State, [], string>(selector, { traceReporter });

    expect(cached(createState({ user }))).toBe("Ada:36");
    expect(cached(createState({ user, unrelated: 1 }))).toBe("Ada:36");

    expect(selector).toHaveBeenCalledTimes(1);
    expect(traceReporter).toHaveBeenCalledTimes(1);
    const trace = traceReporter.mock.calls[0][0];
    expect(trace.selectorFunc).toBe(selector);
    expect(trace.accessedPathCount).toBe(3);
    expect(trace.accessedPaths).toBeInstanceOf(Set);
    expect(Array.from(trace.accessedPaths)).toEqual([
      '["user"]',
      '["user","name"]',
      '["user","age"]',
    ]);
    expect(trace.parsedPaths).toBeInstanceOf(Map);
    expect(Array.from(trace.parsedPaths.entries())).toEqual([
      ['["user"]', ["user"]],
      ['["user","name"]', ["user", "name"]],
      ['["user","age"]', ["user", "age"]],
    ]);
  });
});

describe("tracking proxy raw values", () => {
  it("unwraps proxies created for selector tracking", () => {
    const state = createState();
    const proxy = createTrackingProxy(state, new Set(), new Map());

    expect(getRawValue(proxy)).toBe(state);
    expect(getRawValue(state)).toBe(state);
  });
});