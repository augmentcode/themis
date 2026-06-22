import { describe, expect, it } from "vitest";
import { assertValue, omitKey } from "./utils";

describe("assertValue", () => {
  it("returns defined falsy values", () => {
    expect(assertValue(0)).toBe(0);
    expect(assertValue(false)).toBe(false);
    expect(assertValue("")).toBe("");
  });

  it("throws for nullish values", () => {
    expect(() => assertValue(null)).toThrow("Unexpected empty value");
    expect(() => assertValue(undefined)).toThrow("Unexpected empty value");
  });
});

describe("omitKey", () => {
  it("removes an own key without mutating the original object", () => {
    const original = { a: 1, b: 2, c: 3 };

    const result = omitKey(original, "b");

    expect(result).toEqual({ a: 1, c: 3 });
    expect(original).toEqual({ a: 1, b: 2, c: 3 });
    expect(result).not.toBe(original);
  });

  it("returns the same reference when the key is missing", () => {
    const original = { a: 1 };

    expect(omitKey(original, "missing")).toBe(original);
  });
});