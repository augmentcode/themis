# Invalid skill examples

These examples intentionally omit the test-pattern-safe forms so diagnostics can be mapped back to Markdown lines.

```ts
// todos-selectors.test.ts
import { expect, it } from "vitest";

it("reads visible todos", () => {
  const mockState = { todos: { items: [] } };
  expect(selectVisibleTodos(mockState)).toEqual([]);
});
```

```ts
// todos-saga.test.ts
import { vi } from "vitest";
import * as effects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: (fnOrDescriptor: unknown, ...args: unknown[]) => effects.call(fnOrDescriptor, ...args),
}));
```