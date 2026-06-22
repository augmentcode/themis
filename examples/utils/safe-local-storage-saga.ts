import { call, type SagaGenerator } from "typed-redux-saga";

function getItemFromLocalStorage(key: string): string | null {
  return window.localStorage.getItem(key);
}

function setItemInLocalStorage(key: string, value: string): void {
  window.localStorage.setItem(key, value);
}

function removeItemFromLocalStorage(key: string): void {
  window.localStorage.removeItem(key);
}

function getJSONFromLocalStorage<T>(key: string): T | undefined {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return undefined;
  return JSON.parse(raw) as T;
}

function setJSONInLocalStorage(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function getKeysFromLocalStorageWithPrefix(prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(prefix)) {
      keys.push(key);
    }
  }
  return keys;
}

export function* getLocalStorageItem(key: string): SagaGenerator<string | null> {
  try {
    return yield* call(getItemFromLocalStorage, key);
  } catch {
    return null;
  }
}

export function* getLocalStorageJSON<T>(key: string): SagaGenerator<T | undefined> {
  try {
    return (yield* call(getJSONFromLocalStorage, key)) as T | undefined;
  } catch {
    return undefined;
  }
}

export function* setLocalStorageItem(
  key: string,
  value: string
): SagaGenerator<void> {
  try {
    yield* call(setItemInLocalStorage, key, value);
  } catch {
    // Catch for saga-level safety.
  }
}

export function* setLocalStorageJSON(key: string, value: unknown): SagaGenerator<void> {
  try {
    yield* call(setJSONInLocalStorage, key, value);
  } catch {
    // Catch for saga-level safety.
  }
}

export function* removeLocalStorageItem(key: string): SagaGenerator<void> {
  try {
    yield* call(removeItemFromLocalStorage, key);
  } catch {
    // Catch for saga-level safety.
  }
}

export function* getLocalStorageKeysWithPrefix(prefix: string): SagaGenerator<string[]> {
  try {
    return yield* call(getKeysFromLocalStorageWithPrefix, prefix);
  } catch {
    return [];
  }
}