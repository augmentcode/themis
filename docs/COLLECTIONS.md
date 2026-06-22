# Collections Guide

> **Normalized data structures for managing entities by ID with O(1) lookups.**

---

## Table of Contents

1. [What is a Collection?](#what-is-a-collection)
2. [Creating Collections](#creating-collections)
3. [CRUD Operations](#crud-operations)
4. [Reference Counting](#reference-counting)
5. [Querying Collections](#querying-collections)
6. [When to Use Collections](#when-to-use-collections)
7. [Best Practices](#best-practices)

---

## What is a Collection?

A **Collection** is a normalized data structure that stores entities by ID. It provides O(1) lookups while maintaining insertion order.

```typescript
type Collection<ITEM extends object, K extends string & keyof ITEM> = {
  idField: K;                          // Name of the ID field
  ids: Array<ITEM[K]>;                 // Ordered list of IDs
  map: Record<ITEM[K] & string, ITEM>; // ID → Item lookup
  refsCount: Record<ITEM[K], number>;  // Reference counting
};
```

All Collection operations are **immutable** — they return new Collection objects, never mutate the original.

**Public imports:** Use the explicit utility leaf `@augmentcode/themis/utils/collections/collection-utils`.

---

## Creating Collections

```typescript
import { createCollection } from "@augmentcode/themis/utils/collections/collection-utils";

type Todo = { id: string; title: string; completed: boolean };

// Empty collection
const todos = createCollection<Todo, "id">("id");

// Collection with initial items
const todos = createCollection<Todo, "id">("id", [
  { id: "1", title: "Buy milk", completed: false },
  { id: "2", title: "Write docs", completed: true },
]);
```

## CRUD Operations

All operations return a **new** Collection. The original is never modified.

### Adding Items

```typescript
import { addItem, addItems, addItemAt, upsertItem } from "@augmentcode/themis/utils/collections/collection-utils";

// Add a single item (no-op if ID already exists)
const updated = addItem(collection, { id: "3", title: "New todo", completed: false });

// Add multiple items at once
const updated = addItems(collection, [item1, item2, item3]);

// Add at a specific index
const updated = addItemAt(collection, 0, newItem); // Insert at beginning

// Add or update (upsert)
const updated = upsertItem(collection, item); // Adds if new, merges if exists
```

### Updating Items

```typescript
import { updateItem, replaceItem } from "@augmentcode/themis/utils/collections/collection-utils";

// Merge partial updates into an existing item
const updated = updateItem(collection, { id: "1", completed: true });
// Original item fields are preserved; only specified fields are overwritten

// Replace an item entirely (can change the ID)
const updated = replaceItem(collection, "old-id", newItem);
```

`updateItem` uses shallow equality — if the merged result equals the original, the same collection reference is returned (no unnecessary re-renders).

### Removing Items

```typescript
import { removeItem } from "@augmentcode/themis/utils/collections/collection-utils";

// Remove by ID
const updated = removeItem(collection, "1");
// Removes from ids, map, and refsCount
```

---

## Reference Counting

Collections include a `refsCount` map for tracking how many places reference an item. This is useful when multiple features share entities and you want to clean up only when no one references an item anymore.

```typescript
import {
  addItemAndCountRef,
  increaseRefsCount,
  decreaseRefsCount,
  getRefsCount,
} from "@augmentcode/themis/utils/collections/collection-utils";

// Add an item and set its ref count to 1
const updated = addItemAndCountRef(collection, newItem);

// Increment ref count for an existing item
const updated = increaseRefsCount(collection, itemId);

// Decrement ref count — removes the item when count reaches 0
const updated = decreaseRefsCount(collection, itemId);

// Query the current ref count
const count = getRefsCount(collection, itemId);
```

### How `decreaseRefsCount` Works

When the reference count drops to 0 (or below), the item is **automatically removed** from the collection (both `ids` and `map`). This enables automatic cleanup patterns:

```typescript
// In a reducer:
.with(removeContextItem, (state, { payload: [itemId] }) => ({
  ...state,
  collection: decreaseRefsCount(state.collection, itemId),
}))
```

---

## Querying Collections

```typescript
import {
  getItem,
  getItems,
  findItem,
  filterItems,
  filterCollection,
} from "@augmentcode/themis/utils/collections/collection-utils";

// Get a single item by ID — O(1)
const item = getItem(collection, "1");

// Get all items as an ordered array
const items = getItems(collection);

// Find first item matching a predicate
const found = findItem(collection, (item) => item.completed);

// Filter items (returns array)
const completed = filterItems(collection, (item): item is Todo => item.completed);

// Filter collection (returns new Collection, preserves structure)
const completedCollection = filterCollection(collection, (item): item is Todo => item.completed);
```

---

## When to Use Collections

### ✅ Use Collections When

- Entities have a unique ID field
- You need fast lookup by ID (O(1) vs O(n) array scan)
- You need to maintain insertion order
- Multiple parts of the app reference the same entities
- You want reference counting for cleanup

### ❌ Use Plain Objects/Arrays When

- Data is a simple list without unique IDs
- Data is small and never looked up by ID
- Data is write-once, read-sequentially

---

## Best Practices

1. **Always use `getItem()` instead of `.find()`** — O(1) vs O(n):

   ```typescript
   // ✅ GOOD
   const item = getItem(collection, id);

   // ❌ BAD
   const item = getItems(collection).find((i) => i.id === id);
   ```

2. **Use separate maps for derived state** — Don't add flags to items:

   ```typescript
   // ✅ GOOD: Separate maps
   type State = {
     items: Collection<Item, "id">;
     pinnedItems: Record<string, boolean>;
   };

   // ❌ BAD: Flags on items
   type ItemWithFlags = Item & { isPinned: boolean };
   ```

3. **Access items through selectors** — Don't import collection utils in components:

   ```typescript
   // In selectors file
	   export const selectTodo = store.createSelector((state, id: string) => {
	     return getItem(selectTodosCollection.select(state), id);
	   });
   ```

4. **Use `upsertItem` when you don't know if the item exists** — It handles both add and update cases.

