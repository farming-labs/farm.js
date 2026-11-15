const oneShotSnapshots = new WeakMap<object, readonly unknown[]>();

const arrayIterator = /* @__PURE__ */ (() => Array.prototype[Symbol.iterator])();

/** Materialize an iterable without consuming a one-shot iterator more than once. */
export function materializeIterable<Item>(source: Iterable<Item> | null | undefined): Item[] {
  if (source == null) return [];
  // A plain array iterates by index, so copy it without the iterator protocol.
  if (
    Array.isArray(source) &&
    Object.getPrototypeOf(source) === Array.prototype &&
    source[Symbol.iterator] === arrayIterator
  ) {
    const items: Item[] = [];
    for (let index = 0; index < source.length; index += 1) items.push(source[index]);
    return items;
  }

  const iterator = source[Symbol.iterator]();
  const oneShot =
    iterator === (source as unknown) &&
    (typeof source === "object" || typeof source === "function");
  if (oneShot) {
    const cached = oneShotSnapshots.get(source as object);
    if (cached) return cached as Item[];
  }

  const items = Array.from({ [Symbol.iterator]: () => iterator });
  if (oneShot) oneShotSnapshots.set(source as object, items);
  return items;
}
