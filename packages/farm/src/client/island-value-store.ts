/**
 * The browser's store of island values (RFC 0003; protocol in `island-value-protocol.ts`). It
 * keeps every value it has read, parses each once, and gives islands that share a value the same
 * object. Only islands mode ships it: its client entry hands it to the hydration runtime.
 */
import {
  FARM_ISLAND_VALUE_STORE_KEY,
  FARM_MAX_HELD_VALUES,
  FARM_VALUE_ATTRIBUTE,
  FARM_VALUE_KEY_PATTERN,
  FARM_VALUE_REFERENCE,
  type FarmIslandValueStore,
} from "./island-value-protocol";

/** Past this many values the store starts over at the next navigation. */
const FARM_MAX_STORED_VALUES = 1024;

interface FarmValueEntry {
  json: string;
  state: "raw" | "resolving" | "resolved";
  value?: unknown;
}

function createFarmIslandValueStore(): FarmIslandValueStore {
  // Map order is use order: a value moves to the end each time an island resolves it.
  const entries = new Map<string, FarmValueEntry>();
  const read = new WeakSet<Element>();

  const get = (key: string): unknown => {
    const entry = entries.get(key);
    if (!entry) throw new Error(`island value ${key} was not found`);
    entries.delete(key);
    entries.set(key, entry);
    if (entry.state === "resolved") return entry.value;
    if (entry.state === "resolving") throw new Error(`island value ${key} refers to itself`);
    entry.state = "resolving";
    try {
      entry.value = resolve(JSON.parse(entry.json));
    } catch (error) {
      entry.state = "raw";
      throw error;
    }
    entry.state = "resolved";
    entry.json = "";
    return entry.value;
  };

  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (!value || typeof value !== "object") return value;
    const keys = Object.keys(value);
    const reference = (value as Record<string, unknown>)[FARM_VALUE_REFERENCE];
    if (keys.length === 1 && typeof reference === "string") return get(reference);
    const resolved: Record<string, unknown> = {};
    for (const key of keys) resolved[key] = resolve((value as Record<string, unknown>)[key]);
    return resolved;
  };

  return {
    ingest(root) {
      for (const script of root.querySelectorAll(`script[${FARM_VALUE_ATTRIBUTE}]`)) {
        if (read.has(script)) continue;
        read.add(script);
        const key = script.getAttribute(FARM_VALUE_ATTRIBUTE) ?? "";
        if (FARM_VALUE_KEY_PATTERN.test(key) && !entries.has(key)) {
          entries.set(key, { json: script.textContent || "null", state: "raw" });
        }
      }
    },
    resolve,
    heldHeader() {
      if (entries.size > FARM_MAX_STORED_VALUES) entries.clear();
      if (entries.size === 0) return undefined;
      return [...entries.keys()].slice(-FARM_MAX_HELD_VALUES).join(",");
    },
  };
}

/** The page's value store, shared by every copy of the runtime. */
export function getFarmIslandValueStore(): FarmIslandValueStore {
  const scope = globalThis as typeof globalThis & Record<symbol, FarmIslandValueStore | undefined>;
  return (scope[FARM_ISLAND_VALUE_STORE_KEY] ??= createFarmIslandValueStore());
}
