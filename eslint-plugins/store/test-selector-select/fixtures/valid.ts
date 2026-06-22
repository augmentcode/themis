import { expect, it } from "vitest";
import { selectVisibleTodos } from "../todos-selectors";

it("reads selector output through the pure .select test path", () => {
  const mockState = { todos: { items: [{ id: "1", text: "Ship" }] } };

  expect(selectVisibleTodos.select(mockState, "open")).toEqual([{ id: "1", text: "Ship" }]);
});