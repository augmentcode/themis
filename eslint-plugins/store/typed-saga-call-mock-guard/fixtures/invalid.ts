import { vi } from "vitest";
import * as effects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: unknown, ...args: unknown[]) {
    return yield effects.call(fnOrDescriptor, ...args);
  },
  put: effects.put,
}));