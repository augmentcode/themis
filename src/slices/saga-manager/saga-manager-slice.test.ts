import { describe, expect, it } from "vitest";
import {
  addCrash,
  clearCrashes,
  MAX_SAGA_CRASH_REPORTS,
  sagaManagerReducer,
  startSaga,
  stopSaga,
  type SerializedSagaCrashReport,
} from "./saga-manager-slice";

const crashReport = (id: number): SerializedSagaCrashReport => ({
  crashedAtTs: id,
  error: {
    name: "Error",
    message: `Crash ${id}`,
    stack: `stack ${id}`,
  },
});

describe("saga manager lifecycle actions", () => {
  it("uses namespaced action types", () => {
    const syncTodosSaga = function* syncTodosSaga() {};

    expect(startSaga("syncTodos", syncTodosSaga)).toEqual({
      type: "sagaManager/startSaga",
      payload: ["syncTodos", syncTodosSaga],
    });
    expect(stopSaga("syncTodos")).toEqual({
      type: "sagaManager/stopSaga",
      payload: ["syncTodos"],
    });
  });
});

describe("saga manager crash reducer", () => {
  it("adds one serialized crash report for the target saga", () => {
    const report = crashReport(1);
    const action = addCrash("syncTodos", report);

    const state = sagaManagerReducer(undefined, action);

    expect(action.payload).toEqual(["syncTodos", report]);
    expect(state.syncTodos).toEqual({ reports: [report], omittedCount: 0 });
  });

  it("clears crash data for only the requested saga", () => {
    const action = clearCrashes("syncTodos");
    const state = [
      addCrash("syncTodos", crashReport(1)),
      addCrash("syncUsers", crashReport(2)),
      action,
    ].reduce(sagaManagerReducer, sagaManagerReducer.initialState);

    expect(action.payload).toEqual(["syncTodos"]);
    expect(state.syncTodos).toBeUndefined();
    expect(state.syncUsers).toEqual({ reports: [crashReport(2)], omittedCount: 0 });
  });

  it("stores crash reports independently per saga name", () => {
    const state = [
      addCrash("syncTodos", crashReport(1)),
      addCrash("syncUsers", crashReport(2)),
      addCrash("syncTodos", crashReport(3)),
    ].reduce(sagaManagerReducer, sagaManagerReducer.initialState);

    expect(state.syncTodos.reports).toEqual([crashReport(1), crashReport(3)]);
    expect(state.syncUsers.reports).toEqual([crashReport(2)]);
  });

  it("keeps only the newest 100 crash reports for one saga", () => {
    const state = Array.from({ length: MAX_SAGA_CRASH_REPORTS + 1 }, (_, index) =>
      addCrash("syncTodos", crashReport(index + 1))
    ).reduce(sagaManagerReducer, sagaManagerReducer.initialState);

    expect(state.syncTodos.reports).toHaveLength(MAX_SAGA_CRASH_REPORTS);
    expect(state.syncTodos.reports[0]).toEqual(crashReport(2));
    expect(state.syncTodos.reports.at(-1)).toEqual(crashReport(101));
  });

  it("increments omitted count when older crash reports are trimmed", () => {
    const state = Array.from({ length: MAX_SAGA_CRASH_REPORTS + 3 }, (_, index) =>
      addCrash("syncTodos", crashReport(index + 1))
    ).reduce(sagaManagerReducer, sagaManagerReducer.initialState);

    expect(state.syncTodos.omittedCount).toBe(3);
    expect(state.syncTodos.reports[0]).toEqual(crashReport(4));
  });
});