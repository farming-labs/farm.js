/**
 * Values JSON cannot hold, in islands mode (RFC 0003): each travels as a one-key object, like the
 * other `$farm` markers in props.
 *
 *   undefined                 {"$farmUndefined":1}
 *   NaN, ±Infinity, -0        {"$farmNumber":"NaN"}
 *   12345678901234567890n     {"$farmBigInt":"12345678901234567890"}
 *   new Date(…)               {"$farmDate":"2026-10-28T09:00:00.000Z"}   (null for an invalid date)
 *   new Map([[k, v]])         {"$farmMap":[[k, v]]}                      (keys and values encoded)
 *   new Set([v])              {"$farmSet":[v]}
 *   new URL(…)                {"$farmURL":"https://example.com/"}
 *   /ab+c/gi                  {"$farmRegExp":["ab+c","gi"]}
 *   Uint8Array, ArrayBuffer…  {"$farmBytes":["Uint8Array","base64…"]}
 *
 * Any object key starting with `$farm` is reserved, so these never collide with app data. Decoding
 * accepts input from the browser (server action arguments): it builds plain objects without
 * assigning `__proto__`, and rejects unknown markers.
 */

export const FARM_RESERVED_KEY_PREFIX = "$farm";

const TYPED_ARRAYS = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
} as const;

type TypedArrayName = keyof typeof TYPED_ARRAYS | "ArrayBuffer" | "DataView";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Whether a key is reserved for markers, so app data cannot use it. */
export function isFarmReservedKey(key: string): boolean {
  return key.startsWith(FARM_RESERVED_KEY_PREFIX);
}

/**
 * The marker for a value JSON cannot hold and that has no children (everything above but `Map` and
 * `Set`), or undefined when the value needs no marker.
 */
export function encodeFarmLeaf(value: unknown): Record<string, unknown> | undefined {
  switch (typeof value) {
    case "undefined":
      return { $farmUndefined: 1 };
    case "bigint":
      return { $farmBigInt: value.toString() };
    case "number":
      if (Number.isNaN(value)) return { $farmNumber: "NaN" };
      if (value === Infinity) return { $farmNumber: "Infinity" };
      if (value === -Infinity) return { $farmNumber: "-Infinity" };
      if (Object.is(value, -0)) return { $farmNumber: "-0" };
      return undefined;
    case "object":
      break;
    default:
      return undefined;
  }
  if (value === null) return undefined;
  if (value instanceof Date) {
    return { $farmDate: Number.isNaN(value.getTime()) ? null : value.toISOString() };
  }
  if (typeof URL === "function" && value instanceof URL) return { $farmURL: value.href };
  if (value instanceof RegExp) return { $farmRegExp: [value.source, value.flags] };
  if (value instanceof ArrayBuffer) {
    return { $farmBytes: ["ArrayBuffer", toBase64(new Uint8Array(value))] };
  }
  if (ArrayBuffer.isView(value)) {
    const name = value instanceof DataView ? "DataView" : value.constructor.name;
    if (name !== "DataView" && !(name in TYPED_ARRAYS)) return undefined;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { $farmBytes: [name, toBase64(bytes)] };
  }
  return undefined;
}

/** Returned by `decodeFarmMarker` for an object that is not a type marker. */
export const NOT_A_FARM_MARKER: unique symbol = Symbol.for("farm.codec.not-a-marker");

/**
 * The value a type marker stands for, decoding a `Map`'s or `Set`'s entries with `decodeChild`.
 * Returns `NOT_A_FARM_MARKER` for any other object, and throws for a malformed marker.
 */
export function decodeFarmMarker(
  object: Record<string, unknown>,
  decodeChild: (value: unknown) => unknown,
): unknown {
  const keys = Object.keys(object);
  if (keys.length !== 1) return NOT_A_FARM_MARKER;
  const key = keys[0]!;
  const data = object[key];
  switch (key) {
    case "$farmUndefined":
      return undefined;
    case "$farmNumber":
      if (data === "NaN") return Number.NaN;
      if (data === "Infinity") return Infinity;
      if (data === "-Infinity") return -Infinity;
      if (data === "-0") return -0;
      break;
    case "$farmBigInt":
      if (typeof data === "string" && /^-?\d+$/.test(data)) return BigInt(data);
      break;
    case "$farmDate":
      if (data === null) return new Date(Number.NaN);
      if (typeof data === "string") return new Date(data);
      break;
    case "$farmURL":
      if (typeof data === "string") return new URL(data);
      break;
    case "$farmRegExp":
      if (Array.isArray(data) && typeof data[0] === "string" && typeof data[1] === "string") {
        return new RegExp(data[0], data[1]);
      }
      break;
    case "$farmBytes": {
      if (!Array.isArray(data) || typeof data[1] !== "string") break;
      const name = data[0] as TypedArrayName;
      const bytes = fromBase64(data[1]);
      if (name === "ArrayBuffer") return bytes.buffer;
      if (name === "DataView") return new DataView(bytes.buffer as ArrayBuffer);
      const TypedArray = TYPED_ARRAYS[name as keyof typeof TYPED_ARRAYS];
      if (TypedArray) {
        return new TypedArray(
          bytes.buffer as ArrayBuffer,
          0,
          bytes.byteLength / TypedArray.BYTES_PER_ELEMENT,
        );
      }
      break;
    }
    case "$farmMap":
      if (
        Array.isArray(data) &&
        data.every((entry) => Array.isArray(entry) && entry.length === 2)
      ) {
        return new Map(
          data.map(([entryKey, entryValue]) => [decodeChild(entryKey), decodeChild(entryValue)]),
        );
      }
      break;
    case "$farmSet":
      if (Array.isArray(data)) return new Set(data.map(decodeChild));
      break;
    default:
      return NOT_A_FARM_MARKER;
  }
  throw new TypeError(`malformed ${key} marker`);
}

/**
 * Encodes a value for JSON with the markers above: plain objects, arrays and the types listed.
 * Functions, symbols, class instances and circular values throw. Used for server action
 * arguments and results.
 */
export function encodeFarmJson(value: unknown, seen = new Set<object>()): unknown {
  const leaf = encodeFarmLeaf(value);
  if (leaf) return leaf;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value !== "object") throw new TypeError(`${typeof value} values are not serializable`);
  if (seen.has(value)) throw new TypeError("circular values are not serializable");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => encodeFarmJson(entry, seen));
    if (value instanceof Map) {
      return {
        $farmMap: Array.from(value, ([key, entry]) => [
          encodeFarmJson(key, seen),
          encodeFarmJson(entry, seen),
        ]),
      };
    }
    if (value instanceof Set)
      return { $farmSet: Array.from(value, (entry) => encodeFarmJson(entry, seen)) };
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("class instances are not serializable");
    }
    const encoded: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isFarmReservedKey(key)) throw new TypeError(`${key} is a reserved key`);
      encoded[key] = encodeFarmJson(entry, seen);
    }
    return encoded;
  } finally {
    seen.delete(value);
  }
}

/** Decodes what `encodeFarmJson` produced, after `JSON.parse`. */
export function decodeFarmJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeFarmJson);
  if (!value || typeof value !== "object") return value;
  const marker = decodeFarmMarker(value as Record<string, unknown>, decodeFarmJson);
  if (marker !== NOT_A_FARM_MARKER) return marker;
  const decoded: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isFarmReservedKey(key)) throw new TypeError(`unknown ${key} marker`);
    // defineProperty, not assignment: a "__proto__" key stays an ordinary property.
    Object.defineProperty(decoded, key, {
      value: decodeFarmJson(entry),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return decoded;
}
