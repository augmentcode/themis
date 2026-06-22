import { describe, expect, it } from "vitest";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../../constants";
import { selectUpdatesLocked } from "./store-utility-selectors";

describe("store utility selectors", () => {
  it("reads update lock state from the internal store utility domain", () => {
    expect(
      selectUpdatesLocked.select({
        [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked: true },
      })
    ).toBe(true);
  });

  it("treats a missing internal store utility state as unlocked", () => {
    expect(selectUpdatesLocked.select({})).toBe(false);
  });
});
