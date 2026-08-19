import { afterEach, describe, expect, it, vi } from "vitest";
import { runSaga, stdChannel } from "redux-saga";
import { getBackOffDelay, sagaManager } from "./manager";
import { addCrash, startSaga, stopSaga } from "../saga-manager-slice";
import { INTERNAL_STORE_UTILITY_DOMAIN } from "../../../constants";
import { unlockUpdates } from "../../store-utility/store-utility-slice";
import type { StoreAction } from "../../../types";

const reduxStore = { getState: () => ({}), subscribe: () => () => {}, dispatch: vi.fn() } as any;

const latestStatus = (exposeContext: ReturnType<typeof vi.fn>, sagaName: string) => {
  return exposeContext.mock.calls.at(-1)?.[0]?.[sagaName];
};

const waitFor = async <T>(read: () => T | undefined): Promise<T> => {
  for (let i = 0; i < 20; i++) {
    const value = read();
    if (value !== undefined) return value;
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for saga manager test condition");
};

const startManager = (updatesLocked = false) => {
  const channel = stdChannel();
  const dispatched: StoreAction<any>[] = [];
  const exposeContext = vi.fn();
  const reportRuntimeError = vi.fn();
  const task = runSaga(
    {
      channel,
      dispatch: (action: StoreAction<any>) => {
        dispatched.push(action);
        return action;
      },
      getState: () => ({
        [INTERNAL_STORE_UTILITY_DOMAIN]: { updatesLocked },
      }),
    },
    sagaManager,
    reduxStore,
    exposeContext,
    reportRuntimeError
  );

  return { channel, dispatched, exposeContext, reportRuntimeError, task };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sagaManager crash persistence", () => {
  it("dispatches serialized crashes, unlocks updates, logs, and restarts after backoff", async () => {
    vi.useFakeTimers();
    const error = new Error("boom");
    error.name = "SagaCrashError";
    const crashingSaga = vi.fn(function* () {
      throw error;
    });
    const { channel, dispatched, reportRuntimeError, task } = startManager(true);

    channel.put(startSaga("syncTodos", crashingSaga));

    const crashAction = await waitFor(() =>
      dispatched.find((action) => action.type === addCrash.type) as ReturnType<typeof addCrash> | undefined
    );
    const [sagaName, report] = crashAction.payload;
    expect(crashingSaga).toHaveBeenCalledTimes(1);
    expect(sagaName).toBe("syncTodos");
    expect(report.crashedAtTs).toEqual(expect.any(Number));
    expect(report.error).toEqual({
      name: "SagaCrashError",
      message: "boom",
      stack: error.stack,
    });
    expect(report.error).not.toBeInstanceOf(Error);
    expect(dispatched.map((action) => action.type)).toContain(unlockUpdates.type);
    expect(reportRuntimeError).toHaveBeenCalledWith({
      error,
      source: "saga-manager",
      message: expect.stringContaining('Saga "syncTodos" crashed first time'),
    });

    await vi.advanceTimersByTimeAsync(getBackOffDelay(0));
    await waitFor(() => (crashingSaga.mock.calls.length === 2 ? true : undefined));

    task.cancel();
    await task.toPromise();
  });

  it("stores the started saga function for crash restarts", async () => {
    vi.useFakeTimers();
    const crashingSaga = vi.fn(function* () {
      throw new Error("restart me");
    });
    const { channel, task } = startManager();

    channel.put(startSaga("lateRegistered", crashingSaga));
    await waitFor(() => (crashingSaga.mock.calls.length === 1 ? true : undefined));
    await vi.advanceTimersByTimeAsync(getBackOffDelay(0));
    await waitFor(() => (crashingSaga.mock.calls.length === 2 ? true : undefined));

    task.cancel();
    await task.toPromise();
  });

  it("preserves start/stop reference counting and context exposure", async () => {
    const blockingSaga = vi.fn(function* () {
      yield new Promise(() => {});
    });
    const { channel, exposeContext, task } = startManager();

    channel.put(startSaga("persistent", blockingSaga));
    await waitFor(() => latestStatus(exposeContext, "persistent")?.isRunning ? true : undefined);
    channel.put(startSaga("persistent", blockingSaga));
    await waitFor(() => (blockingSaga.mock.calls.length === 1 ? true : undefined));

    channel.put(stopSaga("persistent"));
    await waitFor(() => latestStatus(exposeContext, "persistent")?.isRunning ? true : undefined);
    channel.put(stopSaga("persistent"));
    await waitFor(() => latestStatus(exposeContext, "persistent")?.isRunning === false ? true : undefined);

    task.cancel();
    await task.toPromise();
  });

  it("throws when the same running saga name is started with a different function", async () => {
    const firstSaga = vi.fn(function* () {
      yield new Promise(() => {});
    });
    const secondSaga = vi.fn(function* () {
      yield new Promise(() => {});
    });
    const { channel, exposeContext, task } = startManager();

    channel.put(startSaga("persistent", firstSaga));
    await waitFor(() => latestStatus(exposeContext, "persistent")?.isRunning ? true : undefined);
    channel.put(startSaga("persistent", secondSaga));

    await expect(task.toPromise()).rejects.toThrow(
      'Saga "persistent" is already running with a different saga function.'
    );
  });
});