/**
 * Cache key serialization, kept free of server imports: browser code such as
 * the client data cache builds the same keys, and importing `./cache` would
 * pull observability and OpenTelemetry into client bundles.
 */

export type RouteDataCacheKey = string | readonly unknown[];

export function createRouteDataCacheKey(key: RouteDataCacheKey): string {
  return createFarmCacheKey(Array.isArray(key) ? key : [key]);
}

export function createFarmCacheKey(parts: readonly unknown[]): string {
  return stableSerialize(parts);
}

export function getFunctionCacheIdentity(fn: Function): string {
  // The name alone collides across modules — two different functions both
  // named getUser would share cache entries. Include a hash of the source so
  // only genuinely identical functions share, and the identity stays stable
  // across processes and restarts.
  const name = fn.name || "anonymous";
  return `${name}:${hashFunctionSource(String(fn))}`;
}

function hashFunctionSource(source: string): string {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function serializeBinaryBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function serializeCanonicalStringEntries(
  entries: Iterable<readonly [string, string]>,
  seen: WeakSet<object>,
): string {
  const valuesByKey = new Map<string, string[]>();
  for (const [key, item] of entries) {
    const values = valuesByKey.get(key);
    if (values) values.push(item);
    else valuesByKey.set(key, [item]);
  }

  return Array.from(valuesByKey.keys())
    .sort(compareCodepoint)
    .flatMap((key) =>
      valuesByKey
        .get(key)!
        .map((item) => `[${stableSerialize(key, seen)},${stableSerialize(item, seen)}]`),
    )
    .join(",");
}

function isPlainCacheKeyObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return true;

  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  return (
    Object.getPrototypeOf(prototype) === null &&
    typeof constructor === "function" &&
    constructor.name === "Object"
  );
}

function getCacheKeyValueType(value: object): string {
  const prototype = Object.getPrototypeOf(value);
  const constructor = prototype
    ? Object.getOwnPropertyDescriptor(prototype, "constructor")?.value
    : undefined;
  if (typeof constructor === "function" && constructor.name) {
    return constructor.name;
  }

  return Object.prototype.toString.call(value).slice(8, -1) || "object";
}

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const valueType = typeof value;
  if (valueType === "string") return JSON.stringify(value);
  if (valueType === "number" || valueType === "boolean" || valueType === "bigint") {
    return `${valueType}:${String(value)}`;
  }
  if (valueType === "symbol") {
    return `symbol:${String(value)}`;
  }
  if (valueType === "function") {
    return `function:${getFunctionCacheIdentity(value as Function)}`;
  }

  if (value instanceof Date) {
    // toISOString throws on an Invalid Date. Key building must not throw on a
    // supported type, so all invalid dates share one stable marker and the
    // caller's own validation decides what to do with the input.
    return Number.isNaN(value.getTime()) ? "date:invalid" : `date:${value.toISOString()}`;
  }
  if (value instanceof URL) {
    return `url:${value.toString()}`;
  }
  if (value instanceof RegExp) {
    return `regexp:${value.toString()}`;
  }
  if (value instanceof ArrayBuffer) {
    return `arraybuffer:${serializeBinaryBytes(new Uint8Array(value))}`;
  }
  if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) {
    return `sharedarraybuffer:${serializeBinaryBytes(new Uint8Array(value))}`;
  }
  if (ArrayBuffer.isView(value)) {
    const viewType = Object.prototype.toString.call(value).slice(8, -1);
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return `binary:${viewType}:${serializeBinaryBytes(bytes)}`;
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        items.push(
          Object.prototype.hasOwnProperty.call(value, index)
            ? stableSerialize(value[index], seen)
            : "[Hole]",
        );
      }
      seen.delete(value);
      return `[${items.join(",")}]`;
    }

    // Set and Map keep their contents internally, so Object.entries is empty
    // for both. Serialize the contents and sort them by codepoint so equal
    // contents give the same key regardless of insertion order.
    if (value instanceof Set) {
      const items = Array.from(value, (item) => stableSerialize(item, seen)).sort(compareCodepoint);
      seen.delete(value);
      return `set:[${items.join(",")}]`;
    }
    if (value instanceof Map) {
      const items = Array.from(
        value,
        ([key, item]) => `[${stableSerialize(key, seen)},${stableSerialize(item, seen)}]`,
      ).sort(compareCodepoint);
      seen.delete(value);
      return `map:[${items.join(",")}]`;
    }
    // URLSearchParams and Headers keep their contents internally, so
    // Object.entries is empty for both (same rationale as Set/Map above).
    // Canonicalize key order while preserving the order of repeated values for
    // each key. URLSearchParams treats `a=1&a=2` and `a=2&a=1` as observably
    // different inputs, while `b=2&a=1` and `a=1&b=2` should still share a key.
    if (value instanceof URLSearchParams) {
      const serialized = serializeCanonicalStringEntries(value, seen);
      seen.delete(value);
      return `urlsearchparams:[${serialized}]`;
    }
    if (value instanceof Headers) {
      const serialized = serializeCanonicalStringEntries(value, seen);
      seen.delete(value);
      return `headers:[${serialized}]`;
    }

    if (!isPlainCacheKeyObject(value)) {
      throw new TypeError(
        `Cache keys do not support ${getCacheKeyValueType(value)} values. Convert the value to an explicit stable string or structured key before caching.`,
      );
    }

    // Codepoint comparison, not localeCompare: the host locale must not
    // change how a "stable" key serializes, or invalidations computed on one
    // server can miss entries written by another.
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      compareCodepoint(a, b),
    );
    const serialized = entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item, seen)}`)
      .join(",");

    seen.delete(value);
    return `{${serialized}}`;
  }

  return String(value);
}
