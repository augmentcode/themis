import { describe, expect, it } from "vitest";
import {
  addItem,
  addItemAt,
  addItems,
  createCollection,
  decreaseRefsCount,
  deduplicateCollection,
  filterCollection,
  filterItems,
  findItem,
  findLastItem,
  getItem,
  getItemIndex,
  getItems,
  getLastItem,
  getRefsCount,
  increaseRefsCount,
  isCollection,
  purgeCollection,
  removeItem,
  replaceItem,
  replaceItems,
  updateItem,
  upsertItem,
} from "./collection-utils";

type Todo = { id: string; title: string; done: boolean };

const todo = (id: string, title = id, done = false): Todo => ({ id, title, done });

describe("collection shape helpers", () => {
  it("creates a normalized collection and lets the last duplicate item win", () => {
    const first = todo("a", "first");
    const replacement = todo("a", "replacement");

    const collection = createCollection("id", [first, todo("b"), replacement]);

    expect(collection).toEqual({
      idField: "id",
      ids: ["a", "b"],
      map: { a: replacement, b: todo("b") },
      refsCount: {},
    });
  });

  it("recognizes only strict collection-shaped objects", () => {
    const collection = createCollection("id", [todo("a")]);

    expect(isCollection(collection)).toBe(true);
    expect(isCollection({ ...collection, extra: true })).toBe(false);
    expect(isCollection({ ...collection, ids: {} })).toBe(false);
  });

  it("purges items while preserving the collection id field", () => {
    const collection = increaseRefsCount(createCollection("id", [todo("a")]), "a");

    expect(purgeCollection(collection)).toEqual({
      idField: "id",
      ids: [],
      map: {},
      refsCount: {},
    });
  });
});

describe("collection mutations", () => {
  it("adds only new string-id items and preserves reference for no-op adds", () => {
    const collection = createCollection("id", [todo("a")]);
    const invalid = { id: 1, title: "invalid", done: false } as unknown as Todo;

    expect(addItems(collection, [])).toBe(collection);
    expect(addItem(collection, todo("a", "ignored duplicate"))).toBe(collection);

    const result = addItems(collection, [todo("b"), invalid]);
    expect(result.ids).toEqual(["a", "b"]);
    expect(result.map).toEqual({ a: todo("a"), b: todo("b") });
  });

  it("inserts items at requested positions", () => {
    const collection = createCollection("id", [todo("a"), todo("b")]);

    expect(addItemAt(collection, 1, todo("c")).ids).toEqual(["a", "c", "b"]);
    expect(addItemAt(collection, -1, todo("c")).ids).toEqual(["c", "a", "b"]);
    expect(addItemAt(collection, 1, todo("a"))).toBe(collection);
  });

  it("updates shallowly and preserves reference when the item does not change", () => {
    const collection = createCollection("id", [todo("a")]);

    expect(updateItem(collection, { id: "a", title: "a", done: false })).toBe(collection);
    expect(updateItem(collection, { id: "missing", title: "missing" })).toBe(collection);

    const result = updateItem(collection, { id: "a", done: true });
    expect(result.map.a).toEqual(todo("a", "a", true));
    expect(result.ids).toBe(collection.ids);
  });

  it("upserts by adding missing items and updating existing items", () => {
    const collection = createCollection("id", [todo("a")]);

    expect(upsertItem(collection, todo("b")).ids).toEqual(["a", "b"]);
    expect(upsertItem(collection, todo("a", "updated")).map.a).toEqual(todo("a", "updated"));
  });

  it("removes items, map entries, and ref counts", () => {
    const collection = increaseRefsCount(createCollection("id", [todo("a"), todo("b")]), "a");

    expect(removeItem(collection, "missing")).toBe(collection);
    expect(removeItem(collection, "a")).toEqual({
      idField: "id",
      ids: ["b"],
      map: { b: todo("b") },
      refsCount: {},
    });
  });

  it("replaces item ids and carries ref counts to the new id", () => {
    const collection = increaseRefsCount(createCollection("id", [todo("a"), todo("b")]), "a");

    const result = replaceItem(collection, "a", todo("c"));
    expect(result.ids).toEqual(["c", "b"]);
    expect(result.map).toEqual({ b: todo("b"), c: todo("c") });
    expect(result.refsCount).toEqual({ c: 1 });
    expect(replaceItems(collection, [["missing", todo("c")]])).toBe(collection);
  });
});

describe("collection refs and queries", () => {
  it("counts refs and removes an item when the count reaches zero", () => {
    const collection = createCollection("id", [todo("a")]);
    const counted = increaseRefsCount(increaseRefsCount(collection, "a"), "a");

    expect(getRefsCount(collection, "a")).toBe(1);
    expect(getRefsCount(collection, "missing")).toBe(0);
    expect(getRefsCount(counted, "a")).toBe(2);

    const decreased = decreaseRefsCount(counted, "a");
    expect(decreased.ids).toEqual(["a"]);
    expect(decreased.refsCount).toEqual({ a: 1 });
    expect(decreaseRefsCount(decreased, "a").ids).toEqual([]);
  });

  it("filters and deduplicates while preserving references for no-op paths", () => {
    const collection = createCollection("id", [todo("a"), todo("b", "b", true)]);
    const all = (item: Todo): item is Todo => Boolean(item);
    const done = (item: Todo): item is Todo => item.done;

    expect(filterCollection(collection, all)).toBe(collection);
    expect(filterCollection(collection, done).ids).toEqual(["b"]);
    expect(deduplicateCollection(collection)).toBe(collection);
    expect(deduplicateCollection({ ...collection, ids: ["a", "a", "b"] }).ids).toEqual([
      "a",
      "b",
    ]);
  });

  it("returns items in id order and skips dangling ids", () => {
    const collection = {
      ...createCollection("id", [todo("a"), todo("b", "b", true), todo("c", "c", true)]),
      ids: ["a", "missing", "b", "c"],
    };

    expect(getItem(collection, "a")).toEqual(todo("a"));
    expect(getLastItem(collection)).toEqual(todo("c", "c", true));
    expect(getItemIndex(collection, "b")).toBe(2);
    expect(getItems(collection)).toEqual([todo("a"), todo("b", "b", true), todo("c", "c", true)]);
    expect(findItem(collection, (item) => item.done)).toEqual(todo("b", "b", true));
    expect(findLastItem(collection, (item) => item.done)).toEqual(todo("c", "c", true));
    expect(filterCollection(collection, (item): item is Todo => item.done).ids).toEqual(["b", "c"]);
    expect(filterItems(collection, (item): item is Todo => item.done)).toEqual([
      todo("b", "b", true),
      todo("c", "c", true),
    ]);
  });
});