import { describe, expect, it } from "vitest";
import { createAction } from "./create-action";
import { createBooleanPreference } from "./boolean-preference";
import { createDomainScopedHelpers } from "./domain-scoped";
import { createReducer } from "./create-reducer";

describe("createReducer", () => {
  it("returns initial state for undefined state", () => {
    const initialState = { count: 0 };
    const reducer = createReducer(initialState);

    expect(reducer(undefined, { type: "unknown" })).toBe(initialState);
  });

  it("preserves state reference for unhandled actions", () => {
    const initialState = { count: 0 };
    const reducer = createReducer(initialState);

    expect(reducer(initialState, { type: "unknown" })).toBe(initialState);
  });

  it("registers action handlers through the chainable builder", () => {
    const increment = createAction<[amount: number]>("counter/increment");
    const reducer = createReducer({ count: 0 }).with(
      increment,
      (state, { payload: [amount] }) => ({ count: state.count + amount })
    );

    expect(reducer({ count: 1 }, increment(2))).toEqual({ count: 3 });
    expect(reducer.initialState).toEqual({ count: 0 });
  });

  it("preserves state reference when a handler returns a shallow-equal state", () => {
    const rename = createAction<[label: string]>("counter/rename");
    const reducer = createReducer({ count: 1, label: "one" }).with(
      rename,
      (state, { payload: [label] }) => ({ ...state, label })
    );
    const state = { count: 1, label: "one" };

    expect(reducer(state, rename("one"))).toBe(state);
    expect(reducer(state, rename("two"))).toEqual({ count: 1, label: "two" });
  });
});

describe("createBooleanPreference", () => {
  it("registers set and toggle handlers on a reducer builder", () => {
    type SettingsState = { enabled: boolean; label: string };
    const preference = createBooleanPreference<SettingsState>({
      sliceName: "settings",
      field: "enabled",
      setActionName: "setEnabled",
      toggleActionName: "toggleEnabled",
    });
    const initialState: SettingsState = { enabled: false, label: "beta" };
    const reducer = preference.register(createReducer(initialState));

    expect(reducer(undefined, preference.setAction(true))).toEqual({
      enabled: true,
      label: "beta",
    });
    expect(reducer({ enabled: true, label: "beta" }, preference.toggleAction())).toEqual({
      enabled: false,
      label: "beta",
    });
    expect(reducer(initialState, preference.setAction(false))).toBe(initialState);
    expect(reducer.initialState).toBe(initialState);
  });
});

describe("createDomainScopedHelpers", () => {
  it("gets empty state for missing domains and stores domain state immutably", () => {
    const emptyDomain = { count: 0 };
    const helpers = createDomainScopedHelpers(emptyDomain);
    const state = { byDomainId: {} };

    expect(helpers.getDomainState(state, "missing")).toBe(emptyDomain);

    const nextState = helpers.setDomainState(state, "a", { count: 1 });
    expect(nextState).toEqual({ byDomainId: { a: { count: 1 } } });
    expect(nextState).not.toBe(state);
    expect(nextState.byDomainId).not.toBe(state.byDomainId);
  });

  it("clears domain state and preserves reference when nothing changes", () => {
    const helpers = createDomainScopedHelpers({ count: 0 });
    const state = { byDomainId: { a: { count: 1 }, b: { count: 2 } } };

    expect(helpers.clearDomainState(state, "missing")).toBe(state);
    expect(helpers.clearDomainState(state, "a")).toEqual({
      byDomainId: { b: { count: 2 } },
    });
  });

  it("preserves state reference when setting a shallow-equal domain state", () => {
    type DomainState = { count: number; label?: string };
    const helpers = createDomainScopedHelpers<DomainState>({ count: 0 });
    const state = { byDomainId: { a: { count: 1, label: "one" } } };

    expect(helpers.setDomainState(state, "a", { count: 1, label: "one" })).toBe(state);
    expect(helpers.setDomainState(state, "a", { count: 2, label: "two" })).toEqual({
      byDomainId: { a: { count: 2, label: "two" } },
    });
  });

  it("compares domain values shallowly and preserves unrelated references", () => {
    const nested = { count: 1 };
    const helpers = createDomainScopedHelpers({ nested });
    const domain = { nested };
    const otherDomain = { nested: { count: 2 } };
    const state = { byDomainId: { a: domain, b: otherDomain }, label: "domains" };

    const unchanged = helpers.setDomainState(state, "a", { nested });
    expect(unchanged).toBe(state);
    expect(unchanged.byDomainId).toBe(state.byDomainId);
    expect(unchanged.byDomainId.a).toBe(domain);

    const replacement = { nested: { count: 1 } };
    const changed = helpers.setDomainState(state, "a", replacement);
    expect(changed).not.toBe(state);
    expect(changed.byDomainId).not.toBe(state.byDomainId);
    expect(changed.byDomainId.a).toBe(replacement);
    expect(changed.byDomainId.b).toBe(otherDomain);
    expect(changed.label).toBe(state.label);
    expect(state.byDomainId.a).toBe(domain);
  });

  it("stores a missing domain even when its value matches the read fallback", () => {
    const emptyDomain = { count: 0 };
    const helpers = createDomainScopedHelpers(emptyDomain);
    const state = { byDomainId: {} };

    expect(helpers.getDomainState(state, "new")).toBe(emptyDomain);
    const next = helpers.setDomainState(state, "new", emptyDomain);
    expect(next).not.toBe(state);
    expect(next.byDomainId).not.toBe(state.byDomainId);
    expect(helpers.getDomainState(next, "new")).toBe(emptyDomain);
    expect(state.byDomainId).toEqual({});
  });
});
