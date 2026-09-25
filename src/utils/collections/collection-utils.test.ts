import { describe, expect, it } from "vitest";
import { shallowEqual } from "fast-equals";
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
  type Collection,
} from "./collection-utils";

type Todo = { id: string; title: string; done: boolean };

const todo = (id: string, title = id, done = false): Todo => ({ id, title, done });

function freezeCollection(collection: Collection<Todo, "id">) {
  Object.values(collection.map).forEach(Object.freeze);
  Object.freeze(collection.ids);
  Object.freeze(collection.map);
  Object.freeze(collection.refsCount);
  Object.freeze(collection);
  return collection;
}

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

describe("collection construction compatibility", () => {
  it("creates independent ordinary containers for omitted and empty inputs", () => {
    const omitted = createCollection<Todo, "id">("id");
    const empty = createCollection("id", [] as Todo[]);
    expect(omitted).toEqual({ idField: "id", ids: [], map: {}, refsCount: {} });
    expect(empty).toEqual(omitted);
    for (const key of ["ids", "map", "refsCount"] as const) {
      expect(empty[key]).not.toBe(omitted[key]);
    }
    expect(Object.getPrototypeOf(empty.map)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(empty.refsCount)).toBe(Object.prototype);
  });

  it("keeps first ID order and last item identity for frozen ordinary-ID inputs", () => {
    const ids = ["a", "constructor", "toString", "", "2", "1", "a", ""];
    const items = ids.map((id, i) => Object.freeze(todo(id, String(i))));
    Object.freeze(items);
    const collection = createCollection("id", items);
    expect(collection.ids).toEqual(ids.slice(0, 6));
    expect(Object.getPrototypeOf(collection.map)).toBe(Object.prototype);
    for (const id of collection.ids) {
      const item = items.findLast((item) => item.id === id);
      expect(Object.getOwnPropertyDescriptor(collection.map, id)).toEqual({
        value: item, enumerable: true, writable: true, configurable: true,
      });
      expect(collection.map[id]).toBe(item);
    }
    expect(collection.ids).not.toBe(ids);
    expect(collection.refsCount).toEqual({});
    expect(items.map((item) => item.id)).toEqual(ids);
  });

  it("preserves a 256-ID frozen collection through a fixed sequence of shallow updates", () => {
    const originals = Array.from({ length: 256 }, (_, i) => Object.freeze(todo(`item${255 - i}`)));
    const firstDuplicate = Object.freeze(todo("item255", "first duplicate"));
    const lastDuplicate = Object.freeze(todo("item255", "last duplicate"));
    const middleDuplicate = Object.freeze(todo("item128", "middle duplicate"));
    const items = [
      ...originals.slice(0, 128), firstDuplicate, ...originals.slice(128),
      lastDuplicate, middleDuplicate,
    ];
    Object.freeze(items);
    const inputBefore = structuredClone(items);
    const collection = createCollection("id", items);
    const expectedItems = originals.map((item) => item.id === "item255" ? lastDuplicate
      : item.id === "item128" ? middleDuplicate : item);
    const expectedIds = originals.map((item) => item.id);

    expect(collection.ids).toEqual(expectedIds);
    expect(Object.keys(collection.map)).toEqual(expectedIds);
    expect(Object.getPrototypeOf(collection.map)).toBe(Object.prototype);
    expect(collection.refsCount).toEqual({});
    for (const item of expectedItems) expect(collection.map[item.id]).toBe(item);

    collection.refsCount = { item255: 3, item128: 7, item0: 2 };
    freezeCollection(collection);
    const collectionBefore = structuredClone(collection);
    const updates = [
      Object.freeze({ id: "item255", done: true }),
      Object.freeze({ id: "item128", title: "updated middle" }),
      Object.freeze({ id: "item255", title: "updated again" }),
    ];
    Object.freeze(updates);
    const updatesBefore = structuredClone(updates);
    let current = collection;
    for (const patch of updates) {
      const previous = current;
      const previousBefore = structuredClone(previous);
      current = updateItem(previous, patch);
      expect(current).not.toBe(previous);
      expect(current.map).not.toBe(previous.map);
      expect(Object.getPrototypeOf(current.map)).toBe(Object.prototype);
      expect(Object.keys(current.map)).toEqual(expectedIds);
      expect(current.idField).toBe("id");
      expect(current.ids).toBe(collection.ids);
      expect(current.refsCount).toBe(collection.refsCount);
      expect(current.map[patch.id]).toEqual({ ...previous.map[patch.id], ...patch });
      expect(current.map[patch.id]).not.toBe(previous.map[patch.id]);
      expect(current.map[patch.id]).not.toBe(patch);
      for (const id of expectedIds) {
        if (id !== patch.id) expect(current.map[id]).toBe(previous.map[id]);
      }
      expect(previous).toEqual(previousBefore);
      freezeCollection(current);
    }
    expect(updateItem(current, current.map.item255)).toBe(current);
    expect(updateItem(current, Object.freeze({ id: "missing", done: true }))).toBe(current);
    expect(current.map.item255).toEqual(todo("item255", "updated again", true));
    expect(current.map.item128).toEqual(todo("item128", "updated middle"));
    expect(collection).toEqual(collectionBefore);
    expect(items).toEqual(inputBefore);
    expect(updates).toEqual(updatesBefore);
    for (const item of expectedItems) expect(collection.map[item.id]).toBe(item);
  });

  it("supports other ID fields without cloning items", () => {
    const items = [{ key: "b", value: 1 }, { key: "a", value: 2 }, { key: "b", value: 3 }];
    const collection = createCollection("key", items);
    expect(collection.idField).toBe("key");
    expect(collection.ids).toEqual(["b", "a"]);
    expect(collection.map.b).toBe(items[2]);
    expect(collection.map.a).toBe(items[1]);
  });

  it("retains sparse-array and non-string runtime construction behavior", () => {
    const items = new Array<Todo>(4);
    items[1] = todo("a");
    items[3] = todo("a", "last");
    expect(createCollection("id", items)).toEqual({
      idField: "id", ids: [undefined, "a"], map: { a: items[3] }, refsCount: {},
    });
    const unusual = [NaN, NaN, -0, 0, 1, "1"].map((id) => ({ id })) as unknown as Todo[];
    const result = createCollection("id", unusual);
    expect(result.ids).toEqual([NaN, 0, 1, "1"]);
    expect(result.map.NaN).toBe(unusual[1]);
    expect(result.map["0"]).toBe(unusual[3]);
    expect(result.map["1"]).toBe(unusual[5]);
  });
});

describe("collection deduplication compatibility", () => {
  it.each([[], ["a"], ["constructor", "toString", ""]])(
    "returns the frozen collection unchanged for unique IDs %j", (...ids) => {
      const collection = freezeCollection(createCollection("id", ids.map((id) => todo(id))));
      expect(deduplicateCollection(collection)).toBe(collection);
    }
  );

  it("only replaces IDs, retaining first order and frozen map/count/item references", () => {
    const collection = createCollection("id", [todo("a"), todo("constructor"), todo("")]);
    collection.ids = ["constructor", "a", "constructor", "", "a", ""];
    collection.refsCount = { a: 7, constructor: 2, "": 3 };
    freezeCollection(collection);
    const result = deduplicateCollection(collection);
    expect(result).not.toBe(collection);
    expect(result.ids).toEqual(["constructor", "a", ""]);
    expect(result.map).toBe(collection.map);
    expect(result.refsCount).toBe(collection.refsCount);
    expect(collection.ids).toEqual(["constructor", "a", "constructor", "", "a", ""]);
  });

  it("preserves strict equality for NaN, signed zero, object identity and sparse IDs", () => {
    const object = {};
    const other = {};
    const symbol = Symbol("id");
    const ids = [NaN, NaN, -0, 0, object, object, other, symbol, symbol, undefined];
    ids.length++;
    const collection = freezeCollection({ ...createCollection<Todo, "id">("id"), ids: ids as unknown as string[] });
    const result = deduplicateCollection(collection);
    expect(result.ids).toEqual([-0, object, other, symbol, undefined]);
    expect(Object.is(result.ids[0], -0)).toBe(true);
    expect(result.ids[1]).toBe(object);
    expect(result.ids[2]).toBe(other);
    expect(result.map).toBe(collection.map);
    expect(result.refsCount).toBe(collection.refsCount);
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

describe("bulk replacement compatibility", () => {
  function counted(ids = ["a", "b", "c"]) {
    const collection = createCollection("id", ids.map((id) => todo(id)));
    collection.refsCount = Object.fromEntries(ids.map((id, i) => [id, [2, 7, 11][i]]));
    return freezeCollection(collection);
  }

  function replacements(pairs: string[][]): Array<[string, Todo]> {
    const tuples = pairs.map(([source, target], i): [string, Todo] =>
      [source, Object.freeze(todo(target, `replacement ${i}`))]);
    tuples.forEach(Object.freeze);
    Object.freeze(tuples);
    return tuples;
  }

  it("returns the original frozen collection for empty, missing and invalid batches", () => {
    const collection = counted();
    expect(replaceItems(collection, [])).toBe(collection);
    expect(replaceItems(collection, replacements([["missing", "a"], ["constructor", "b"]]))).toBe(collection);
    for (const id of [undefined, null, 1, NaN, {}, new String("a")]) {
      const invalid = Object.freeze({ id }) as unknown as Todo;
      expect(replaceItems(collection, [["a", invalid]])).toBe(collection);
    }
    const empty = counted([]);
    expect(replaceItems(empty, replacements([["a", "b"]]))).toBe(empty);
  });

  it("does not inspect replacement IDs for missing sources or match a runtime NaN source", () => {
    const collection = counted();
    const unread = { get id() { throw new Error("missing source must be skipped"); } } as Todo;
    expect(replaceItems(collection, [["missing", unread]])).toBe(collection);
    const unusual = freezeCollection({ ...createCollection<Todo, "id">("id"), ids: [NaN] as unknown as string[] });
    expect(replaceItems(unusual, [[NaN as unknown as string, todo("x")]])).toBe(unusual);
  });

  it("copies containers for same-ID/same-object replacements and retains absent source counts", () => {
    const collection = freezeCollection(createCollection("id", [todo("a"), todo("b")]));
    const result = replaceItems(collection, [["a", collection.map.a]]);
    expect(result).not.toBe(collection);
    expect(result.ids).toEqual(collection.ids);
    for (const key of ["ids", "map", "refsCount"] as const) {
      expect(result[key]).not.toBe(collection[key]);
    }
    expect(result.map.a).toBe(collection.map.a);
    expect(result.map.b).toBe(collection.map.b);
    expect(result.refsCount).toEqual({ a: undefined });
    expect(Object.hasOwn(result.refsCount, "a")).toBe(true);
    expect(getRefsCount(result, "a")).toBe(1);
    expect(collection.refsCount).toEqual({});
  });

  it.each([
    { source: "a", target: "c", ids: ["c", "b"], count: 2 },
    { source: "c", target: "a", ids: ["a", "b"], count: 11 },
  ])("collision $source -> $target keeps the first resulting position and source count", ({ source, target, ids, count }) => {
    const collection = counted();
    const tuples = replacements([[source, target]]);
    const result = replaceItems(collection, tuples);
    expect(result.ids).toEqual(ids);
    expect(result.map).toEqual({ b: collection.map.b, [target]: tuples[0][1] });
    expect(result.map[target]).toBe(tuples[0][1]);
    expect(result.map.b).toBe(collection.map.b);
    expect(result.refsCount).toEqual({ b: 7, [target]: count });
    expect(collection.ids).toEqual(["a", "b", "c"]);
    expect(collection.refsCount).toEqual({ a: 2, b: 7, c: 11 });
  });

  it("lets the last valid source tuple set the ID without dropping earlier destination items", () => {
    const collection = counted();
    const tuples = replacements([["a", "x"], ["a", "y"]]);
    const invalid = { id: 1 } as unknown as Todo;
    const result = replaceItems(collection, [...tuples, ["a", invalid]]);
    expect(result.ids).toEqual(["y", "b", "c"]);
    expect(result.map).toEqual({ b: collection.map.b, c: collection.map.c, x: tuples[0][1], y: tuples[1][1] });
    expect(result.map.x).toBe(tuples[0][1]);
    expect(result.map.y).toBe(tuples[1][1]);
    expect(result.refsCount).toEqual({ b: 7, c: 11, y: 2 });
  });

  it("removes a superseded same-ID item when the last source tuple renames away", () => {
    const collection = counted();
    const tuples = replacements([["a", "a"], ["a", "x"]]);
    const result = replaceItems(collection, tuples);
    expect(result.ids).toEqual(["x", "b", "c"]);
    expect(result.map).toEqual({ x: tuples[1][1], b: collection.map.b, c: collection.map.c });
    expect(result.map.x).toBe(tuples[1][1]);
    expect(result.refsCount).toEqual({ x: 2, b: 7, c: 11 });
  });

  it.each(["x", "c"])("duplicate destination %s uses tuple order for items, original source order for counts", (target) => {
    const collection = counted();
    for (const sources of [["b", "a"], ["a", "b"]]) {
      const tuples = replacements(sources.map((source) => [source, target]));
      const result = replaceItems(collection, tuples);
      expect(result.ids).toEqual(target === "x" ? ["x", "x", "c"] : ["c"]);
      expect(result.map[target]).toBe(tuples[1][1]);
      expect(result.refsCount).toEqual(target === "x" ? { c: 11, x: 7 } : { c: 7 });
      expect(Object.keys(result.map).sort()).toEqual(target === "x" ? ["c", "x"] : ["c"]);
    }
  });

  it("retains map-only empty destinations rather than changing their legacy rename behavior", () => {
    const collection = counted();
    const tuples = replacements([["a", ""]]);
    const result = replaceItems(collection, tuples);
    expect(result).not.toBe(collection);
    expect(result.ids).toEqual(collection.ids);
    expect(result.map).toEqual({ ...collection.map, "": tuples[0][1] });
    expect(result.map[""]).toBe(tuples[0][1]);
    expect(result.map.a).toBe(collection.map.a);
    expect(result.refsCount).toEqual(collection.refsCount);
  });

  it("can rename an empty-string source and preserves ordinary special-key dictionaries", () => {
    const collection = counted(["", "constructor", "toString"]);
    const tuples = replacements([["", "constructor"]]);
    const result = replaceItems(collection, tuples);
    expect(result.ids).toEqual(["constructor", "toString"]);
    expect(result.map).toEqual({ constructor: tuples[0][1], toString: collection.map.toString });
    expect(result.map.constructor).toBe(tuples[0][1]);
    expect(result.refsCount).toEqual({ constructor: 2, toString: 11 });
    expect(Object.getPrototypeOf(result.map)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.refsCount)).toBe(Object.prototype);
  });

  it.each([
    { name: "swap", pairs: [["a", "b"], ["b", "a"]], ids: ["b", "a", "c"], refs: { b: 2, a: 7, c: 11 } },
    { name: "cycle", pairs: [["a", "b"], ["b", "c"], ["c", "a"]], ids: ["b", "c", "a"], refs: { b: 2, c: 7, a: 11 } },
    { name: "forward chain", pairs: [["a", "b"], ["b", "x"]], ids: ["b", "x", "c"], refs: { b: 2, x: 7, c: 11 } },
    { name: "backward chain", pairs: [["b", "a"], ["a", "x"]], ids: ["x", "a", "c"], refs: { x: 2, a: 7, c: 11 } },
    { name: "long chain", pairs: [["a", "b"], ["b", "c"], ["c", "x"]], ids: ["b", "c", "x"], refs: { b: 2, c: 7, x: 11 } },
  ])("$name preserves replacement objects and original-source counts in either tuple order", ({ pairs, ids, refs }) => {
    const collection = counted();
    const before = structuredClone(collection);
    for (const orderedPairs of [pairs, [...pairs].reverse()]) {
      const tuples = replacements(orderedPairs);
      const result = replaceItems(collection, tuples);
      expect(result.ids).toEqual(ids);
      expect(Object.keys(result.map).sort()).toEqual([...ids].sort());
      expect(result.refsCount).toEqual(refs);
      for (const [, replacement] of tuples) {
        expect(result.map[replacement.id]).toBe(replacement);
      }
      if (!pairs.some(([source]) => source === "c")) {
        expect(result.map.c).toBe(collection.map.c);
      }
      expect(Object.getPrototypeOf(result.map)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(result.refsCount)).toBe(Object.prototype);
      expect(collection).toEqual(before);
    }
  });

  it("uses each original source count even when a collision target has a same-ID replacement", () => {
    const collection = counted();
    const tuples = replacements([["b", "b"], ["a", "b"]]);
    const result = replaceItems(collection, tuples);
    expect(result.ids).toEqual(["b", "c"]);
    expect(result.map.b).toBe(tuples[1][1]);
    expect(result.refsCount).toEqual({ b: 7, c: 11 });
  });

  it("preserves zero and absent counts during a swap without summing or defaulting them", () => {
    const collection = createCollection("id", [todo("a"), todo("b")]);
    collection.refsCount = { a: 0 };
    freezeCollection(collection);
    const tuples = replacements([["a", "b"], ["b", "a"]]);
    const result = replaceItems(collection, tuples);
    expect(result.ids).toEqual(["b", "a"]);
    expect(result.map.b).toBe(tuples[0][1]);
    expect(result.map.a).toBe(tuples[1][1]);
    expect(result.refsCount).toStrictEqual({ b: 0, a: undefined });
    expect(collection.refsCount).toStrictEqual({ a: 0 });
  });

  it("keeps item and count precedence when duplicate destinations also rename onward", () => {
    const collection = counted();
    const tuples = replacements([["b", "c"], ["a", "c"], ["c", "x"]]);
    const result = replaceItems(collection, tuples);
    expect(result.ids).toEqual(["c", "x"]);
    expect(result.map).toEqual({ c: tuples[1][1], x: tuples[2][1] });
    expect(result.map.c).toBe(tuples[1][1]);
    expect(result.map.x).toBe(tuples[2][1]);
    expect(result.refsCount).toEqual({ c: 7, x: 11 });
  });

  it("swaps constructor/toString keys without affecting an untouched entry", () => {
    const collection = counted(["constructor", "toString", "c"]);
    const tuples = replacements([["constructor", "toString"], ["toString", "constructor"]]);
    const result = replaceItems(collection, tuples);
    expect(result.ids).toEqual(["toString", "constructor", "c"]);
    expect(result.map.toString).toBe(tuples[0][1]);
    expect(result.map.constructor).toBe(tuples[1][1]);
    expect(result.map.c).toBe(collection.map.c);
    expect(result.refsCount).toEqual({ toString: 2, constructor: 7, c: 11 });
    expect(Object.getPrototypeOf(result.map)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.refsCount)).toBe(Object.prototype);
  });

  it("ignores missing and invalid tuples alongside an ordinary swap", () => {
    const collection = counted();
    const tuples = replacements([["a", "b"], ["b", "a"], ["missing", "constructor"], ["constructor", "x"]]);
    const invalid = Object.freeze({ id: 1 }) as unknown as Todo;
    const result = replaceItems(collection, [...tuples, ["a", invalid]]);
    expect(result.ids).toEqual(["b", "a", "c"]);
    expect(result.map).toEqual({ a: tuples[1][1], b: tuples[0][1], c: collection.map.c });
    expect(result.map.a).toBe(tuples[1][1]);
    expect(result.map.b).toBe(tuples[0][1]);
    expect(result.refsCount).toEqual({ b: 2, a: 7, c: 11 });
  });

  it("renames a constructor source using its own item and count", () => {
    const collection = counted(["constructor", "a", "b"]);
    const tuples = replacements([["constructor", "x"]]);
    const result = replaceItems(collection, tuples);
    expect(result.ids).toEqual(["x", "a", "b"]);
    expect(result.map).toEqual({ a: collection.map.a, b: collection.map.b, x: tuples[0][1] });
    expect(result.map.x).toBe(tuples[0][1]);
    expect(result.refsCount).toEqual({ a: 7, b: 11, x: 2 });
    expect(Object.getPrototypeOf(result.map)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.refsCount)).toBe(Object.prototype);
  });
});

describe("collection update allocation compatibility", () => {
  it("characterizes fast-equals own string keys, SameValue numbers and nested identity", () => {
    const nested = { value: 1 };
    const symbol = Symbol("ignored by shallow equality");
    expect(shallowEqual({ value: NaN }, { value: NaN })).toBe(true);
    expect(shallowEqual({ value: 0 }, { value: -0 })).toBe(false);
    expect(shallowEqual({ nested }, { nested })).toBe(true);
    expect(shallowEqual({ nested }, { nested: { value: 1 } })).toBe(false);
    expect(shallowEqual({}, { extra: undefined })).toBe(false);
    expect(shallowEqual({ [symbol]: 1 }, { [symbol]: 2 })).toBe(true);
    expect(shallowEqual({}, Object.create({ inherited: 1 }))).toBe(true);
    expect(shallowEqual({}, Object.defineProperty({}, "hidden", { value: 1 }))).toBe(true);
  });

  it("preserves exact frozen containers for partial/full no-ops and shares untouched items on changes", () => {
    const base = createCollection("id", [todo("a"), todo("b")]);
    base.refsCount = { a: 7, b: 2 };
    freezeCollection(base);
    for (const patch of [{ id: "a" }, { id: "a", title: "a" }, { ...base.map.a }]) {
      expect(updateItem(base, Object.freeze(patch))).toBe(base);
    }
    const patch = Object.freeze({ id: "a", title: "changed" });
    const result = updateItem(base, patch);
    expect(result).not.toBe(base);
    expect(result.map).not.toBe(base.map);
    expect(result.map.a).not.toBe(base.map.a);
    expect(result.map.a).not.toBe(patch);
    expect(result.map.a).toEqual({ id: "a", title: "changed", done: false });
    expect(result.map.b).toBe(base.map.b);
    expect(result.ids).toBe(base.ids);
    expect(result.refsCount).toBe(base.refsCount);
    expect(base.map.a.title).toBe("a");
  });

  it("ignores missing/empty/nonstring IDs, but updates own constructor and toString entries", () => {
    const base = freezeCollection(createCollection("id", [todo(""), todo("constructor"), todo("toString")]));
    for (const id of [undefined, null, "", "missing", 0, 1, false, {}, Symbol("id")]) {
      expect(updateItem(base, { id, title: "changed" } as unknown as Partial<Todo>)).toBe(base);
    }
    expect(updateItem(base, {})).toBe(base);
    for (const id of ["constructor", "toString"]) {
      expect(updateItem(base, { id, title: "changed" }).map[id].title).toBe("changed");
    }
  });

  it("keeps NaN and nested references but changes signed zero, fresh nested objects and added undefined keys", () => {
    const nested = Object.freeze({ value: 1 });
    const original = Object.freeze({ id: "a", value: NaN, zero: 0, nested, optional: undefined });
    const base = createCollection("id", [original]);
    expect(updateItem(base, { id: "a", value: NaN, nested, optional: undefined })).toBe(base);
    const zero = updateItem(base, { id: "a", zero: -0 });
    expect(zero).not.toBe(base);
    expect(Object.is(zero.map.a.zero, -0)).toBe(true);
    const fresh = { value: 1 };
    expect(updateItem(base, { id: "a", nested: fresh }).map.a.nested).toBe(fresh);
    const added = updateItem(base, { id: "a", added: undefined } as Partial<typeof original>);
    expect(added).not.toBe(base);
    expect(Object.hasOwn(added.map.a, "added")).toBe(true);
    expect(Object.hasOwn(original, "added")).toBe(false);
  });

  it("reads inherited/nonenumerable patch IDs but merges only enumerable own keys, including symbols", () => {
    const symbol = Symbol("payload");
    const original = { ...todo("a"), [symbol]: 1 };
    Object.defineProperty(original, "hidden", { value: 9 });
    const base = createCollection("id", [original]);
    const inherited = Object.assign(Object.create({ id: "a", done: true }), { title: "changed" });
    const result = updateItem(base, inherited);
    expect(result.map.a).toEqual({ id: "a", title: "changed", done: false, [symbol]: 1 });
    expect(Object.hasOwn(result.map.a, "hidden")).toBe(false);
    const hiddenId = Object.defineProperty({ title: "changed" }, "id", { value: "a" });
    expect(updateItem(base, hiddenId).map.a.title).toBe("changed");
    expect(updateItem(base, Object.defineProperty({ id: "a" }, "title", { value: "ignored" }))).toBe(base);
    // Symbol-only changes are ignored by fast-equals; a string change carries symbols through the spread.
    expect(updateItem(base, { id: "a", [symbol]: 2 })).toBe(base);
    expect(updateItem(base, { id: "a", title: "changed", [symbol]: 2 }).map.a[symbol]).toBe(2);
  });

  it("preserves getter order/count for a no-op merge and repeated map lookup", () => {
    const events: string[] = [];
    const original = { id: "a", get value() { events.push("item:value"); return 1; } };
    const base = createCollection("id", [original]);
    Object.defineProperty(base.map, "a", { enumerable: true, get() { events.push("map:a"); return original; } });
    const patch = {
      get id() { events.push("patch:id"); return "a"; },
      get value() { events.push("patch:value"); return 1; },
    };
    expect(updateItem(base, patch)).toBe(base);
    expect(events).toEqual(["patch:id", "map:a", "map:a", "item:value", "patch:id", "patch:value", "map:a", "item:value"]);
  });

  it("does not treat a class instance's unchanged fields as a plain-object no-op", () => {
    class Item { id = "a"; value = 1; }
    const original = Object.freeze(new Item());
    const base = createCollection("id", [original]);
    const result = updateItem(base, { id: "a", value: 1 });
    expect(result).not.toBe(base);
    expect(result.map.a).toEqual({ id: "a", value: 1 });
    expect(Object.getPrototypeOf(result.map.a)).toBe(Object.prototype);
    expect(base.map.a).toBe(original);
  });
});

describe("collection query allocation compatibility", () => {
  it("findLastItem visits reversed ID snapshots, skips dangling IDs, and passes only the item", () => {
    const base = createCollection("id", [todo("a"), todo("b"), todo("c")]);
    base.ids = ["a", , "missing", "b", "a", "c"] as string[];
    freezeCollection(base);
    const seen: unknown[][] = [];
    const result = findLastItem(base, function (item) { seen.push([...arguments]); return item.id === "b"; });
    expect(result).toBe(base.map.b);
    expect(seen).toEqual([[base.map.c], [base.map.a], [base.map.b]]);
    const all: string[] = [];
    expect(findLastItem(base, (item) => { all.push(item.id); return false; })).toBeUndefined();
    expect(all).toEqual(["c", "a", "b", "a"]);
  });

  it("findLastItem observes live map changes, rereads a match, and does not find an empty ID", () => {
    const base = createCollection("id", [todo("a"), todo("b"), todo("")]);
    const calls: string[] = [];
    expect(findLastItem(base, (item) => { calls.push(item.id); return true; })).toBeUndefined();
    expect(calls).toEqual([""]);
    base.ids = ["a", "b"];
    const replacement = todo("a", "replacement");
    const result = findLastItem(base, (item) => {
      if (item.id === "b") { base.ids.length = 0; base.map.a = replacement; return false; }
      expect(item).toBe(replacement);
      base.map.a = todo("a", "reread");
      return true;
    });
    expect(result).toBe(base.map.a);
    expect(result?.title).toBe("reread");
  });

  it("findLastItem reads map entries in reverse and reads a successful entry twice", () => {
    const events: string[] = [];
    const a = todo("a"); const b = todo("b");
    const base = { idField: "id" as const, ids: ["a", "b"], refsCount: {}, map: {
      get a() { events.push("get:a"); return a; }, get b() { events.push("get:b"); return b; },
    } };
    expect(findLastItem(base, (item) => { events.push(`call:${item.id}`); return item.id === "a"; })).toBe(a);
    expect(events).toEqual(["get:b", "call:b", "get:a", "call:a", "get:a"]);
  });

  it("findLastItem snapshots every ID accessor in forward order before a tail-hit callback", () => {
    const events: string[] = [];
    const base = createCollection("id", [todo("a"), todo("b"), todo("c")]);
    for (const [index, id] of ["a", "b", "c"].entries()) {
      Object.defineProperty(base.ids, index, { get() { events.push(`id:${id}`); return id; } });
    }
    expect(findLastItem(base, (item) => { events.push(`call:${item.id}`); return true; })).toBe(base.map.c);
    expect(events).toEqual(["id:a", "id:b", "id:c", "call:c"]);
  });

  for (const operation of [filterItems, filterCollection]) {
    it(`${operation.name} maps before callbacks and exposes a compact snapshot with duplicate positions`, () => {
      const events: string[] = [];
      const a = todo("a"); const b = todo("b");
      const base = { idField: "id" as const, ids: ["a", , "missing", "b", "a"] as string[], refsCount: { a: 7 }, map: {
        get a() { events.push("get:a"); return a; }, get b() { events.push("get:b"); return b; },
      } };
      const arrays: Todo[][] = [];
      const predicate = function (item: Todo, index: number, array: Todo[]) {
        expect(arguments.length).toBe(3);
        events.push(`call:${item.id}:${index}`);
        arrays.push(array);
        expect(array).toEqual([a, b, a]);
        return true;
      } as unknown as (item: Todo) => item is Todo;
      const result = operation(base, predicate);
      expect(events).toEqual(["get:a", "get:b", "get:a", "call:a:0", "call:b:1", "call:a:2"]);
      expect(arrays.every((array) => array === arrays[0])).toBe(true);
      if (Array.isArray(result)) expect(result).toEqual([a, b, a]);
      else { expect(result.ids).toEqual(["a", "b"]); expect(result.refsCount).toEqual({}); }
    });

    it(`${operation.name} snapshots values before source mutation but permits callback-array mutation`, () => {
      const base = createCollection("id", [todo("a"), todo("b"), todo("c")]);
      const originals = [base.map.a, base.map.b, base.map.c];
      const replacement = todo("x");
      const seen: Todo[] = [];
      const predicate = ((item: Todo, index: number, array: Todo[]) => {
        seen.push(item);
        if (index === 0) {
          base.map.b = todo("b", "source changed");
          base.ids.splice(1, 1, "other");
          array[2] = replacement;
          array.push(todo("ignored append"));
        }
        return index !== 0;
      }) as unknown as (item: Todo) => item is Todo;
      const result = operation(base, predicate);
      expect(seen).toEqual([originals[0], originals[1], replacement]);
      const items = Array.isArray(result) ? result : result.ids.map((id) => result.map[id]);
      expect(items).toEqual([originals[1], replacement]);
      expect(items[0]).toBe(originals[1]);
    });
  }

  it("filters frozen inputs, retains duplicate/empty IDs on all-keep and resets counts only on rebuild", () => {
    const base = createCollection("id", [todo(""), todo("a"), todo("b")]);
    base.ids = ["", "a", "a", "b"];
    base.refsCount = { "": 2, a: 7, b: 4 };
    freezeCollection(base);
    const all = (item: Todo): item is Todo => Boolean(item);
    expect(filterCollection(base, all)).toBe(base);
    const array = filterItems(base, all);
    expect(array).toEqual([base.map[""], base.map.a, base.map.a, base.map.b]);
    expect(filterItems(base, all)).not.toBe(array);
    const kept = filterCollection(base, (item): item is Todo => item.id !== "b");
    expect(kept.ids).toEqual(["", "a"]);
    expect(kept.map.a).toBe(base.map.a);
    expect(kept.map[""]).toBe(base.map[""]);
    for (const key of ["ids", "map", "refsCount"] as const) expect(kept[key]).not.toBe(base[key]);
    expect(kept.refsCount).toEqual({});
    const empty = freezeCollection(createCollection<Todo, "id">("id"));
    expect(filterCollection(empty, all)).toBe(empty);
    expect(findLastItem(empty, () => { throw new Error("empty callback"); })).toBeUndefined();
    expect(filterItems(empty, all)).toEqual([]);
  });

  it("filterCollection's no-op decision uses the current source length, not snapshot identity", () => {
    const base = createCollection("id", [todo("a"), todo("b")]);
    const result = filterCollection(base, (item): item is Todo => {
      if (item.id === "a") base.ids.pop();
      return item.id === "a";
    });
    expect(result).toBe(base);
    expect(Object.hasOwn(result.map, "b")).toBe(true);
  });

  it("findLastItem materializes sparse holes while filters skip them", () => {
    const base = createCollection("id", [todo("a"), todo("undefined")]);
    base.ids = ["a", , "missing"] as string[];
    const seen: string[] = [];
    expect(findLastItem(base, (item) => { seen.push(item.id); return true; })).toBeUndefined();
    expect(seen).toEqual(["undefined"]);
    expect(filterItems(base, (item): item is Todo => Boolean(item))).toEqual([base.map.a]);
    expect(filterCollection(base, (item): item is Todo => Boolean(item)).ids).toEqual(["a"]);
  });

  for (const operation of [filterItems, filterCollection]) {
    it(`${operation.name} skips a deleted callback-snapshot slot and does not append beyond initial length`, () => {
      const base = createCollection("id", [todo("a"), todo("b"), todo("c")]);
      const seen: number[] = [];
      const predicate = function (this: unknown, item: Todo, index: number, array: Todo[]) {
        expect(this).toBeUndefined();
        seen.push(index);
        if (index === 0) { delete array[1]; array.push(todo("ignored")); }
        return Boolean(item);
      } as unknown as (item: Todo) => item is Todo;
      const result = operation(base, predicate);
      expect(seen).toEqual([0, 2]);
      const items = Array.isArray(result) ? result : result.ids.map((id) => result.map[id]);
      expect(items).toEqual([base.map.a, base.map.c]);
    });
  }
});

describe("findLastItem snapshot traversal", () => {
  it("fully consumes a custom iterator before visiting its yielded IDs backward", () => {
    const events: string[] = [];
    const base = createCollection("id", [todo("a"), todo("b"), todo("c")]);
    base.ids[Symbol.iterator] = function* () {
      events.push("yield:b"); yield "b";
      events.push("yield:a"); yield "a";
      events.push("yield:c"); yield "c";
      events.push("iterator:done");
    };
    const b = base.map.b;
    expect(findLastItem(base, function (this: unknown, item) {
      expect(this).toBeUndefined();
      expect(arguments.length).toBe(1);
      events.push(`call:${item.id}`);
      base.ids.length = 0;
      return item === b;
    })).toBe(b);
    expect(events).toEqual(["yield:b", "yield:a", "yield:c", "iterator:done", "call:c", "call:a", "call:b"]);
  });

  it("keeps the forward iterator read sequence for proxied sparse IDs", () => {
    const events: string[] = [];
    const base = createCollection("id", [todo("a"), todo("b"), todo("undefined")]);
    base.ids = new Proxy(["a", , "b"] as string[], {
      get(target, key, receiver) {
        events.push(`ids:${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      getPrototypeOf() { throw new Error("unexpected prototype guard"); },
    });
    expect(findLastItem(base, (item) => {
      events.push(`call:${item.id}`);
      return item.id === "undefined";
    })).toBeUndefined();
    expect(events).toEqual([
      "ids:Symbol(Symbol.iterator)", "ids:length", "ids:0", "ids:length", "ids:1",
      "ids:length", "ids:2", "ids:length", "call:b", "call:undefined",
    ]);
  });

  it("propagates iterator failure without an early tail callback", () => {
    const base = createCollection("id", [todo("a")]);
    const failure = new Error("snapshot failed");
    let calls = 0;
    base.ids[Symbol.iterator] = function* () { yield "a"; throw failure; };
    expect(() => findLastItem(base, () => { calls++; return true; })).toThrow(failure);
    expect(calls).toBe(0);
  });

  it("finishes accessor-driven iterator growth before a tail hit", () => {
    const events: string[] = [];
    const base = createCollection("id", [todo("a"), todo("b"), todo("c")]);
    base.ids = ["a", "b"];
    Object.defineProperty(base.ids, 0, { get() {
      events.push("id:a");
      base.ids.push("c");
      return "a";
    } });
    expect(findLastItem(base, (item) => { events.push(`call:${item.id}`); return true; })).toBe(base.map.c);
    expect(events).toEqual(["id:a", "call:c"]);
    expect(base.ids.length).toBe(3);
  });

  it("rereads a successful entry from the live collection map without continuing", () => {
    const events: string[] = [];
    const a = todo("a"); const b = todo("b"); const replacement = todo("b", "reread");
    let currentMap = { a, b };
    const base = { idField: "id" as const, ids: Object.freeze(["a", "b"]) as unknown as string[], refsCount: {},
      get map() { events.push("map"); return currentMap; },
    };
    expect(findLastItem(base, (item) => {
      events.push(`call:${item.id}`);
      currentMap = { a, b: replacement };
      return true;
    })).toBe(replacement);
    expect(events).toEqual(["map", "call:b", "map"]);
    events.length = 0;
    expect(findLastItem(base, (item) => {
      events.push(`call:${item.id}`);
      delete (currentMap as Partial<typeof currentMap>).b;
      return true;
    })).toBeUndefined();
    expect(events).toEqual(["map", "call:b", "map"]);
  });

  it("does not reread or continue after a truthy predicate for an empty ID", () => {
    const events: string[] = [];
    const a = todo("a"); const empty = todo("");
    const base = { idField: "id" as const, ids: ["a", ""], refsCount: {}, map: {
      get a() { events.push("map:a"); return a; },
      get ""() { events.push("map:empty"); return empty; },
    } };
    expect(findLastItem(base, ((item: Todo) => {
      events.push(`call:${item.id}`);
      return "truthy";
    }) as unknown as (item: Todo) => boolean)).toBeUndefined();
    expect(events).toEqual(["map:empty", "call:"]);
  });
});

describe("deferred collection allocation contracts", () => {
  it("keeps updateItem proxy observations without introducing a prototype guard", () => {
    const events: string[] = [];
    const original = new Proxy({ id: "a", value: 1 }, {
      get(target, key, receiver) { events.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
      ownKeys(target) { events.push("ownKeys"); return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, key) {
        events.push(`descriptor:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf() { throw new Error("unexpected prototype guard"); },
    });
    const base = createCollection("id", [original]);
    events.length = 0;
    expect(updateItem(base, Object.freeze({ id: "a", value: 1 }))).toBe(base);
    expect(events).toEqual([
      "ownKeys", "descriptor:id", "get:id", "descriptor:value", "get:value", "get:constructor",
      "ownKeys", "descriptor:id", "descriptor:value", "descriptor:value", "get:value", "descriptor:id", "get:id",
    ]);
  });

  for (const operation of [filterItems, filterCollection]) {
    it(`${operation.name} preserves array species and the subclass predicate snapshot`, () => {
      const events: string[] = [];
      class IDs extends Array {
        static get [Symbol.species]() { events.push("species"); return IDs; }
      }
      const base = createCollection("id", [todo("a"), todo("b")]);
      base.ids = IDs.of("a", "b") as string[];
      let snapshot: Todo[] | undefined;
      const predicate = ((item: Todo, _index: number, array: Todo[]) => {
        snapshot = array;
        return Boolean(item);
      }) as unknown as (item: Todo) => item is Todo;
      const result = operation(base, predicate);
      expect(events).toEqual(["species", "species", "species"]);
      expect(snapshot).toBeInstanceOf(IDs);
      if (Array.isArray(result)) {
        expect(result).toBeInstanceOf(IDs);
        expect(result).not.toBe(snapshot);
        expect(result[0]).toBe(base.map.a);
      } else expect(result).toBe(base);
    });
  }
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