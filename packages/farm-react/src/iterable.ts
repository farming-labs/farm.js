const oneShotSnapshots = new WeakMap<object, readonly unknown[]>();

/** Materialize an iterable without consuming a one-shot iterator more than once. */
export function materializeIterable<Item>(source: Iterable<Item> | null | undefined): Item[] {
  if (source == null) return [];

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
