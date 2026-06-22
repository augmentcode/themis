import { expect, it } from "vitest";
import { selectVisibleTodos } from "../todos-selectors";

it("accidentally calls the readable selector form with mock state", () => {
  const mockState = { todos: { items: [] } };

  expect(selectVisibleTodos(mockState)).toEqual([]);
});