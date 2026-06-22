import { afterEach, describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  getLocalStorageKeysWithPrefix,
  removeLocalStorageItem,
  setLocalStorageItem,
  setLocalStorageJSON,
} from "./safe-local-storage-saga";

function runToCompletion<T>(saga: () => Generator<any, T, any>) {
  return runSaga({ dispatch: () => {}, getState: () => ({}) }, saga).toPromise();
}

function stubLocalStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  const storage = {
    get length() {
      return entries.size;
    },
    key: vi.fn((index: number) => Array.from(entries.keys())[index] ?? null),
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
    removeItem: vi.fn((key: string) => entries.delete(key)),
  };
  vi.stubGlobal("window", { localStorage: storage });
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("example safe localStorage saga helpers", () => {
  it("reads, writes, and removes string values safely", async () => {
    const storage = stubLocalStorage();

    await runToCompletion(function* () {
      yield* setLocalStorageItem("prefs/theme", "dark");
      return undefined;
    });
    const value = await runToCompletion(function* () {
      return yield* getLocalStorageItem("prefs/theme");
    });
    await runToCompletion(function* () {
      yield* removeLocalStorageItem("prefs/theme");
      return undefined;
    });

    expect(value).toBe("dark");
    expect(storage.getItem("prefs/theme")).toBeNull();
  });

  it("reads and writes JSON values safely", async () => {
    stubLocalStorage();

    await runToCompletion(function* () {
      yield* setLocalStorageJSON("prefs/json", { theme: "dark" });
      return undefined;
    });
    const value = await runToCompletion(function* () {
      return yield* getLocalStorageJSON<{ theme: string }>("prefs/json");
    });

    expect(value).toEqual({ theme: "dark" });
  });

  it("returns keys with the requested prefix", async () => {
    stubLocalStorage({ "prefs/a": "1", "prefs/b": "2", other: "3" });

    const keys = await runToCompletion(function* () {
      return yield* getLocalStorageKeysWithPrefix("prefs/");
    });

    expect(keys).toEqual(["prefs/a", "prefs/b"]);
  });

  it("returns safe fallback values when localStorage throws", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        get length() {
          throw new Error("blocked");
        },
        getItem: vi.fn(() => {
          throw new Error("blocked");
        }),
        setItem: vi.fn(() => {
          throw new Error("blocked");
        }),
        removeItem: vi.fn(() => {
          throw new Error("blocked");
        }),
      },
    });

    await expect(runToCompletion(function* () {
      return yield* getLocalStorageItem("blocked");
    })).resolves.toBeNull();
    await expect(runToCompletion(function* () {
      return yield* getLocalStorageJSON("blocked");
    })).resolves.toBeUndefined();
    await expect(runToCompletion(function* () {
      return yield* getLocalStorageKeysWithPrefix("blocked");
    })).resolves.toEqual([]);
    await expect(runToCompletion(function* () {
      yield* setLocalStorageItem("blocked", "value");
      yield* removeLocalStorageItem("blocked");
    })).resolves.toBeUndefined();
  });
});