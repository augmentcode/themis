import { describe, expect, it } from "vitest";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../store/store-runtime-constants";
import { areStoreUpdatesLocked } from "./store-update-lock";

describe("areStoreUpdatesLocked", () => {
  it("reads the internal store utility lock flag", () => {
    expect(areStoreUpdatesLocked({})).toBe(false);
    expect(areStoreUpdatesLocked(null)).toBe(false);
    expect(
      areStoreUpdatesLocked({
        [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: true },
      })
    ).toBe(true);
  });
});