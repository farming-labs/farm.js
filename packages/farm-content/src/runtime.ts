import type { ContentEntry } from "./types.js";

type RuntimeCollections = Readonly<Record<string, readonly ContentEntry<any>[]>>;

type EncodedContentValue =
  | null
  | boolean
  | number
  | string
  | ["undefined"]
  | ["date", string]
  | ["bigint", string]
  | ["array", EncodedContentValue[]]
  | ["object", Array<[string, EncodedContentValue]>];

export function decodeContentValue(value: EncodedContentValue): any {
  if (!Array.isArray(value)) return value;
  const [kind, payload] = value;
  if (kind === "undefined") return undefined;
  if (kind === "date") return new Date(payload as string);
  if (kind === "bigint") return BigInt(payload as string);
  if (kind === "array")
    return Object.freeze((payload as EncodedContentValue[]).map(decodeContentValue));
  if (kind === "object") {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, entry] of payload as Array<[string, EncodedContentValue]>) {
      Object.defineProperty(result, key, {
        value: decodeContentValue(entry),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(result);
  }
  throw new TypeError(`[farm:content] Unknown encoded content value: ${String(kind)}`);
}

export function createContentRuntime(collections: RuntimeCollections) {
  const indexes = new Map<string, ReadonlyMap<string, ContentEntry<any>>>();

  function collection(name: string): readonly ContentEntry<any>[] {
    const entries = collections[name];
    if (!entries) {
      const available = Object.keys(collections);
      throw new Error(
        `[farm:content] Unknown collection "${name}".${
          available.length
            ? ` Available collections: ${available.join(", ")}`
            : " No collections are configured."
        }`,
      );
    }
    return entries;
  }

  const getCollection = async (name: string) => collection(name);
  const getEntry = async (name: string, id: string) => {
    let index = indexes.get(name);
    if (!index) {
      index = new Map(collection(name).map((entry) => [entry.id, entry]));
      indexes.set(name, index);
    }
    return index.get(id);
  };
  const getEntryOrThrow = async (name: string, id: string) => {
    const entry = await getEntry(name, id);
    if (!entry) {
      throw new Error(`[farm:content] Entry "${id}" was not found in collection "${name}"`);
    }
    return entry;
  };

  return Object.freeze({ getCollection, getEntry, getEntryOrThrow });
}
