import { vi } from "vitest";
import * as effects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: unknown, ...args: unknown[]) {
    return yield Array.isArray(fnOrDescriptor) ? effects.call(fnOrDescriptor, ...args) : effects.call(fnOrDescriptor, ...args);
  },
  put: effects.put,
}));