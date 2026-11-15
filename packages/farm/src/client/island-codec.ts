/**
 * Values JSON cannot hold, in islands mode (RFC 0003). Each travels as a tagged object, like the
 * runtime's own references (island-value-protocol.ts): one reserved key, `$`, holds a short tag,
 * and `v` holds the data.
 *
 *   undefined                 {"$":"u"}
 *   NaN, ±Infinity, -0        {"$":"n","v":"NaN"}
 *   12345678901234567890n     {"$":"B","v":"12345678901234567890"}
 *   new Date(…)               {"$":"D","v":"2026-10-28T09:00:00.000Z"}   (null for an invalid date)
 *   new Map([[k, v]])         {"$":"M","v":[[k, v]]}                      (keys and values tagged)
 *   new Set([v])              {"$":"S","v":[v]}
 *   new URL(…)                {"$":"U","v":"https://example.com/"}
 *   /ab+c/gi                  {"$":"R","v":["ab+c","gi"]}
 *   Uint8Array, ArrayBuffer…  {"$":"Y","v":["Uint8Array","base64…"]}
 *   app data with a "$" key   {"$":"o","v":{…}}                          (never read as a tag)
 *
 * Decoding accepts input from the browser (server action arguments): it builds plain objects
 * without assigning `__proto__`, and rejects unknown or malformed tags.
 */
import {
  FARM_ACTION_TAG,
  FARM_OBJECT_TAG,
  FARM_REFERENCE_TAG,
  FARM_SLOT_TAG,
  FARM_TAG,
  FARM_TAG_VALUE,
  getFarmTag,
} from "./island-value-protocol";

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

/** A tagged object. */
export function farmTagged(tag: string, value?: unknown): Record<string, unknown> {
  return value === undefined ? { [FARM_TAG]: tag } : { [FARM_TAG]: tag, [FARM_TAG_VALUE]: value };
}

/** Whether a plain object must travel wrapped as `o`, because its own keys include `$`. */
export function needsFarmObjectTag(object: object): boolean {
  return Object.prototype.hasOwnProperty.call(object, FARM_TAG);
}

/**
 * The tag for a value JSON cannot hold and that has no children (everything above but `M`, `S`
 * and `o`), or undefined when the value needs none.
 */
export function encodeFarmLeaf(value: unknown): Record<string, unknown> | undefined {
  switch (typeof value) {
    case "undefined":
      return farmTagged("u");
    case "bigint":
      return farmTagged("B", value.toString());
    case "number":
      if (Number.isNaN(value)) return farmTagged("n", "NaN");
      if (value === Infinity) return farmTagged("n", "Infinity");
      if (value === -Infinity) return farmTagged("n", "-Infinity");
      if (Object.is(value, -0)) return farmTagged("n", "-0");
      return undefined;
    case "object":
      break;
    default:
      return undefined;
  }
  if (value === null) return undefined;
  if (value instanceof Date) {
    return farmTagged("D", Number.isNaN(value.getTime()) ? null : value.toISOString());
  }
  if (typeof URL === "function" && value instanceof URL) return farmTagged("U", value.href);
  if (value instanceof RegExp) return farmTagged("R", [value.source, value.flags]);
  if (value instanceof ArrayBuffer) {
    return farmTagged("Y", ["ArrayBuffer", toBase64(new Uint8Array(value))]);
  }
  if (ArrayBuffer.isView(value)) {
    const name = value instanceof DataView ? "DataView" : value.constructor.name;
    if (name !== "DataView" && !(name in TYPED_ARRAYS)) return undefined;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return farmTagged("Y", [name, toBase64(bytes)]);
  }
  return undefined;
}

/** Returned by `decodeFarmTagged` for the runtime's reference tags (`r`, `s`, `a`). */
export const NOT_A_FARM_MARKER: unique symbol = Symbol.for("farm.codec.not-a-marker");

/** A plain object from entries; `defineProperty`, so a "__proto__" key stays an ordinary key. */
export function farmPlainObject(entries: Iterable<[string, unknown]>): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    Object.defineProperty(object, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return object;
}

/**
 * The value a tagged object stands for, decoding children (a `Map`'s or `Set`'s entries, an `o`
 * object's properties) with `decodeChild`. Returns `NOT_A_FARM_MARKER` for the runtime's reference
 * tags, and throws for an unknown or malformed tag.
 */
export function decodeFarmTagged(
  object: Record<string, unknown>,
  decodeChild: (value: unknown) => unknown,
): unknown {
  const tag = object[FARM_TAG] as string;
  const data = object[FARM_TAG_VALUE];
  switch (tag) {
    case FARM_REFERENCE_TAG:
    case FARM_SLOT_TAG:
    case FARM_ACTION_TAG:
      return NOT_A_FARM_MARKER;
    case FARM_OBJECT_TAG:
      if (data && typeof data === "object" && !Array.isArray(data)) {
        return farmPlainObject(
          Object.entries(data).map(([key, value]): [string, unknown] => [key, decodeChild(value)]),
        );
      }
      break;
    case "u":
      return undefined;
    case "n":
      if (data === "NaN") return Number.NaN;
      if (data === "Infinity") return Infinity;
      if (data === "-Infinity") return -Infinity;
      if (data === "-0") return -0;
      break;
    case "B":
      if (typeof data === "string" && /^-?\d+$/.test(data)) return BigInt(data);
      break;
    case "D":
      if (data === null) return new Date(Number.NaN);
      if (typeof data === "string") return new Date(data);
      break;
    case "U":
      if (typeof data === "string") return new URL(data);
      break;
    case "R":
      if (Array.isArray(data) && typeof data[0] === "string" && typeof data[1] === "string") {
        return new RegExp(data[0], data[1]);
      }
      break;
    case "Y": {
      if (!Array.isArray(data) || typeof data[0] !== "string" || typeof data[1] !== "string") break;
      const bytes = fromBase64(data[1]);
      if (data[0] === "ArrayBuffer") return bytes.buffer;
      if (data[0] === "DataView") return new DataView(bytes.buffer as ArrayBuffer);
      const TypedArray = Object.prototype.hasOwnProperty.call(TYPED_ARRAYS, data[0])
        ? TYPED_ARRAYS[data[0] as keyof typeof TYPED_ARRAYS]
        : undefined;
      if (!TypedArray || bytes.byteLength % TypedArray.BYTES_PER_ELEMENT !== 0) break;
      return new TypedArray(
        bytes.buffer as ArrayBuffer,
        0,
        bytes.byteLength / TypedArray.BYTES_PER_ELEMENT,
      );
    }
    case "M":
      if (
        Array.isArray(data) &&
        data.every((entry) => Array.isArray(entry) && entry.length === 2)
      ) {
        return new Map(data.map(([key, value]) => [decodeChild(key), decodeChild(value)]));
      }
      break;
    case "S":
      if (Array.isArray(data)) return new Set(data.map(decodeChild));
      break;
    default:
      throw new TypeError(`unknown ${JSON.stringify(tag)} tag`);
  }
  throw new TypeError(`malformed ${JSON.stringify(tag)} tag`);
}

/**
 * Encodes a value for JSON with the tags above: plain objects, arrays and the types listed.
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
      return farmTagged(
        "M",
        Array.from(value, ([key, entry]) => [
          encodeFarmJson(key, seen),
          encodeFarmJson(entry, seen),
        ]),
      );
    }
    if (value instanceof Set) {
      return farmTagged(
        "S",
        Array.from(value, (entry) => encodeFarmJson(entry, seen)),
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("class instances are not serializable");
    }
    const encoded = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, encodeFarmJson(entry, seen)]),
    );
    return needsFarmObjectTag(value) ? farmTagged(FARM_OBJECT_TAG, encoded) : encoded;
  } finally {
    seen.delete(value);
  }
}

/** Decodes what `encodeFarmJson` produced, after `JSON.parse`. Reference tags are rejected. */
export function decodeFarmJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeFarmJson);
  if (!value || typeof value !== "object") return value;
  if (getFarmTag(value) !== undefined) {
    const decoded = decodeFarmTagged(value as Record<string, unknown>, decodeFarmJson);
    if (decoded === NOT_A_FARM_MARKER) {
      throw new TypeError(
        `a ${JSON.stringify((value as Record<string, unknown>)[FARM_TAG])} reference is not allowed here`,
      );
    }
    return decoded;
  }
  if (needsFarmObjectTag(value)) throw new TypeError('malformed "$" tag');
  return farmPlainObject(Object.entries(value).map(([key, entry]) => [key, decodeFarmJson(entry)]));
}
