import { shallowEqual } from "fast-equals";
import type { Collection } from "../types";

export type { Collection, RefsCounter } from "../types";

function isString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return true;
}

export function createCollection<ITEM extends object, K extends keyof ITEM & string>(
  idFieldName: K,
  items?: ITEM[]
): Collection<ITEM, K> {
  if (!items) {
    return {
      idField: idFieldName,
      ids: [],
      map: {},
      refsCount: {},
    } as unknown as Collection<ITEM, K>;
  }

  const ids = Array.from(new Set(items.map((item) => item[idFieldName])));

  const map: Record<string, ITEM> = {};
  items.forEach((item) => {
    const id = item[idFieldName] as string;
    map[id] = item;
  });

  return {
    idField: idFieldName,
    ids,
    map: { ...map },
    refsCount: {},
  } as Collection<ITEM, K>;
}

export const collectionFieldsSet = new Set(
  Object.keys(createCollection<{ id: string }, "id">("id", []))
);
export function isCollection<ITEM extends object, K extends keyof ITEM & string>(
  item: object
): item is Collection<ITEM, K> {
  const record = item as Record<string, unknown>;

  // Check that all required fields exist with correct types
  if (typeof record.idField !== "string") return false;
  if (!Array.isArray(record.ids)) return false;
  if (typeof record.map !== "object" || record.map === null || Array.isArray(record.map))
    return false;
  if (
    typeof record.refsCount !== "object" ||
    record.refsCount === null ||
    Array.isArray(record.refsCount)
  )
    return false;

  // Check that there are no extra fields beyond collection fields
  const keys = Object.keys(item);
  for (const itemKey of keys) {
    if (!collectionFieldsSet.has(itemKey)) {
      return false;
    }
  }
  return true;
}

export function purgeCollection<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>
): Collection<ITEM, K> {
  return {
    ...collection,
    ids: [],
    map: {},
    refsCount: {},
  } as unknown as Collection<ITEM, K>;
}

export function addItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  newItem: ITEM
) {
  return addItems(collection, [newItem]);
}

/**
 * Batch add function
 * @param collection - The collection to add items to
 * @param newItems - Array of items to add
 * @returns New collection with items added (or original if no items were added)
 */
export function addItems<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  newItems: ITEM[]
): Collection<ITEM, K> {
  if (newItems.length === 0) {
    return collection;
  }

  const { idField } = collection;

  // Build arrays of new IDs and map entries in a single pass
  const newIdsToAdd: Array<ITEM[K]> = [];
  const newMapEntries: Record<string, ITEM> = {};

  const existingIdsSet = new Set(collection.ids);

  for (const item of newItems) {
    const id = item[idField];
    if (!isString(id)) {
      continue;
    }

    // Guard from cases when collection has an object in map, but not in ids list
    const existsInMap = !!collection.map[id];
    const existsInIds = existingIdsSet.has(id);

    // Skip if item already exists in both map and ids
    if (existsInMap && existsInIds) {
      continue;
    }

    // Add new ID only if it doesn't exist in ids yet
    if (!existsInIds) {
      newIdsToAdd.push(id);
      existingIdsSet.add(id);
    }

    // Add/update map entry (overwrite if duplicate within newItems)
    newMapEntries[id] = item;
  }

  // If no new items to add, return original collection
  if (newIdsToAdd.length === 0 && Object.keys(newMapEntries).length === 0) {
    return collection;
  }

  // Spread once: combine existing with new
  const newIds = newIdsToAdd.length > 0 ? [...collection.ids, ...newIdsToAdd] : collection.ids;
  const newMap =
    Object.keys(newMapEntries).length > 0
      ? { ...collection.map, ...newMapEntries }
      : collection.map;

  return {
    ...collection,
    ids: newIds,
    map: newMap,
  };
}

export function addItemAt<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  index: number,
  newItem: ITEM
) {
  const { idField } = collection;
  const id = newItem[idField];
  if (!isString(id)) {
    return collection;
  }
  if (collection.map[id]) {
    return collection;
  }

  const idsWithoutCurrent = collection.ids.filter((itemId) => itemId !== id);
  let ids = [];
  if (index < 0) {
    ids = [id].concat(idsWithoutCurrent);
  } else {
    ids = [...idsWithoutCurrent];
    ids.splice(index, 0, id);
  }

  return {
    ...collection,
    ids,
    map: {
      ...collection.map,
      [id]: newItem,
    },
  };
}

export function addItemAndCountRef<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  newItem: ITEM,
  index?: number
) {
  const { idField } = collection;
  const id = newItem[idField];
  if (!isString(id)) {
    return collection;
  }

  return increaseRefsCount(
    index !== undefined ? addItemAt(collection, index, newItem) : addItem(collection, newItem),
    id
  );
}

export function upsertItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  updatedItem: ITEM
) {
  const id = updatedItem[collection.idField];
  if (!isString(id)) {
    return collection;
  }
  const existinItem = getItem(collection, id);
  if (existinItem) {
    return updateItem(collection, updatedItem);
  }
  return addItem(collection, updatedItem);
}

export function upsertItemAndCountRef<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  newItem: ITEM
) {
  const { idField } = collection;
  const id = newItem[idField];
  if (!isString(id)) {
    return collection;
  }

  return increaseRefsCount(upsertItem(collection, newItem), id);
}

export function updateItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  updatedItem: Partial<ITEM>
) {
  const { idField } = collection;
  const id = updatedItem[idField] as ITEM[K];
  if (!id || !isString(id) || !collection.map[id]) {
    return collection;
  }

  const newItem = {
    ...collection.map[id],
    ...updatedItem,
  };

  if (shallowEqual(newItem, collection.map[id])) {
    return collection;
  }

  return {
    ...collection,
    map: {
      ...collection.map,
      [id]: newItem,
    },
  };
}


export function replaceItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  originalItemId: ITEM[K] & string,
  updatedItem: ITEM
) {
  return replaceItems(collection, [[originalItemId, updatedItem]]);
}

export function replaceItems<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  replaceTuples: Array<[originalItemId: ITEM[K] & string, updatedItem: ITEM]>
): Collection<ITEM, K> {
  if (replaceTuples.length === 0) {
    return collection;
  }

  const originalIndices = new Map<ITEM[K], number>();
  collection.ids.forEach((id, index) => {
    // Match indexOf: first occurrence, skipping holes and non-matching NaN.
    if (id === id && !originalIndices.has(id)) {
      originalIndices.set(id, index);
    }
  });
  const idsIndexMap = new Map<number, ITEM[K] & string>();
  const newItemsMap: Record<string, ITEM> = {};

  for (const [originalItemId, updatedItem] of replaceTuples) {
    const originalIndex = originalIndices.get(originalItemId);
    if (originalIndex === undefined) {
      continue;
    }

    const newId = updatedItem[collection.idField];
    if (!isString(newId)) {
      continue;
    }

    idsIndexMap.set(originalIndex, newId);
    newItemsMap[newId] = updatedItem;
  }

  if (idsIndexMap.size === 0) {
    return collection;
  }

  const destinations = new Set<ITEM[K]>();
  const collisionIds = new Set<ITEM[K]>();
  for (const [index, newId] of idsIndexMap) {
    // Empty destinations historically update only the map, not IDs/counts.
    if (!newId) {
      continue;
    }
    destinations.add(newId);
    if (collection.ids[index] !== newId && originalIndices.has(newId)) {
      collisionIds.add(newId);
    }
  }

  const newIds: Array<ITEM[K]> = [];
  const newMap: Record<ITEM[K] & string, ITEM> = { ...collection.map, ...newItemsMap };
  const newRefCounts = { ...collection.refsCount };
  const seenCollisions = new Set<ITEM[K]>();

  for (let index = 0; index < collection.ids.length; index++) {
    const newId = idsIndexMap.get(index);
    const oldId = collection.ids[index];
    const id = newId || oldId;
    // Only pre-existing destinations are deduplicated; fresh duplicates remain.
    if (!collisionIds.has(id)) {
      newIds.push(id);
    } else if (!seenCollisions.has(id)) {
      newIds.push(id);
      seenCollisions.add(id);
    }
    if (!newId) {
      continue;
    }

    if (oldId !== newId && !destinations.has(oldId)) {
      delete newMap[oldId];
    }
    // Read original source counts, never counts written by an earlier rename.
    // Original position order (not tuple order) still breaks count collisions.
    newRefCounts[newId] = collection.refsCount[oldId];
    if (oldId !== newId && !destinations.has(oldId)) {
      delete newRefCounts[oldId];
    }
  }

  return {
    ...collection,
    ids: newIds,
    map: newMap,
    refsCount: newRefCounts,
  };
}

export function removeItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K]
) {
  if (!isString(itemId)) {
    return collection;
  }

  const ids = collection.ids.filter((id) => {
    return id !== itemId;
  });

  if (ids.length === collection.ids.length && !collection.map[itemId]) {
    return collection;
  }

  const { [itemId]: _item, ...newMap } = collection.map;
  const { [itemId]: _count, ...newRefsCount } = collection.refsCount;

  return {
    ...collection,
    ids,
    map: newMap,
    refsCount: newRefsCount,
  };
}

export function increaseRefsCount<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K]
) {
  if (!isString(itemId)) {
    return collection;
  }

  return {
    ...collection,
    refsCount: {
      ...collection.refsCount,
      [itemId]: (collection.refsCount[itemId] || 0) + 1,
    },
  };
}

export function decreaseRefsCount<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K]
) {
  if (!isString(itemId)) {
    return collection;
  }

  const newRefsCount = (collection.refsCount[itemId] || 0) - 1;

  if (newRefsCount <= 0) {
    const { [itemId]: _count, ...newRefsCount } = collection.refsCount;

    return removeItem(
      {
        ...collection,
        refsCount: newRefsCount,
      },
      itemId
    );
  }

  return {
    ...collection,
    refsCount: {
      ...collection.refsCount,
      [itemId]: newRefsCount,
    },
  };
}

export function filterCollection<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  filterFunction: (item: ITEM) => item is ITEM
) {
  const items = collection.ids
    .map((id) => {
      return collection.map[id];
    })
    .filter((item): item is ITEM => item !== undefined)
    .filter<ITEM>(filterFunction);

  if (items.length === collection.ids.length) {
    return collection;
  }

  return createCollection<ITEM, K>(collection.idField, items);
}

export function deduplicateCollection<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>
) {
  const seen = new Set<ITEM[K]>();
  const ids = collection.ids.filter((id) => {
    // Preserve indexOf's strict equality: NaN never matched, even itself.
    if (id !== id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });

  if (ids.length === collection.ids.length) {
    return collection;
  }

  return {
    ...collection,
    ids,
  };
}

export function getItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K] & string
): ITEM | undefined {
  return collection.map[itemId];
}

export function getLastItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>
): ITEM | undefined {
  const lastItemId = collection.ids[collection.ids.length - 1];
  return getItem(collection, lastItemId);
}

export function getItemIndex<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K]
): number {
  return collection.ids.indexOf(itemId);
}

export function getItems<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>
): ITEM[] {
  const list = [];
  for (const id of collection.ids) {
    if (collection.map[id]) {
      list.push(collection.map[id]);
    }
  }
  return list;
}

export function findItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  findFunction: (item: ITEM) => boolean
): ITEM | undefined {
  const foundId = collection.ids.find((id) => {
    const collectionItem = getItem(collection, id);
    if (!collectionItem) {
      return false;
    }
    return findFunction(collectionItem);
  });
  if (!foundId) {
    return undefined;
  }
  return getItem(collection, foundId);
}

export function findLastItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  findFunction: (item: ITEM) => boolean
): ITEM | undefined {
  // Keep eager forward iteration (including accessors), then scan the snapshot.
  const ids = [...collection.ids];
  for (let index = ids.length - 1; index >= 0; index--) {
    const id = ids[index];
    const collectionItem = getItem(collection, id);
    if (collectionItem && findFunction(collectionItem)) {
      // Preserve empty-ID behavior and reread the successful entry from the live map.
      return id ? getItem(collection, id) : undefined;
    }
  }
  return undefined;
}

export function filterItems<T extends ITEM, ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  filterFunction: (item: ITEM) => item is T
) {
  return collection.ids
    .map((id) => {
      return collection.map[id];
    })
    .filter((item): item is ITEM => item !== undefined)
    .filter<T>(filterFunction);
}

export function getRefsCount<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K] & string
): number {
  if (!collection.refsCount[itemId]) {
    return collection.map[itemId] ? 1 : 0;
  }
  return collection.refsCount[itemId];
}