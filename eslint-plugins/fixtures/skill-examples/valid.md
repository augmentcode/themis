# Valid skill examples

Selector tests use the pure `.select` helper with explicit mock state.

```ts
// todos-selectors.test.ts
import { expect, it } from "vitest";

it("reads visible todos", () => {
  const mockState = { todos: { items: [] } };
  expect(selectVisibleTodos.select(mockState)).toEqual([]);
});
```

Saga tests keep tuple calls working in the typed-redux-saga mock.

```ts
// todos-saga.test.ts
import { vi } from "vitest";
import * as effects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: (fnOrDescriptor: unknown, ...args: unknown[]) =>
    Array.isArray(fnOrDescriptor) ? effects.call(fnOrDescriptor, ...args) : effects.call(fnOrDescriptor, ...args),
}));
```