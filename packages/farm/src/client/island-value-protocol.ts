/**
 * The islands wire format (RFC 0003): the names the server writes into HTML, JSON and headers, and
 * the browser reads back. Every element, script type and header carries the `f` prefix; JSON uses
 * one reserved key, `$`, whose value is a short tag:
 *
 *   <f-island src="/src/toc.tsx" export="Toc" props="_R_b_" strategy="load">…</f-island>
 *   <script type="f/props" for="_R_b_">{…props…}</script>
 *   <script type="f/value" name="04jiw29097x8ki">…a value sent once…</script>
 *   <f-slot name="_R_5_s0">…server output passed as children…</f-slot>
 *
 *   {"$":"r","v":"04jiw29097x8ki"}   a value sent once, by key
 *   {"$":"s","v":"_R_5_s0"}          a slot
 *   {"$":"a","v":"nSaHH8FImEr_M6"}   a server action
 *   {"$":"o","v":{…}}                app data that has its own "$" key
 *   …and the types JSON cannot hold (island-codec.ts)
 *
 * A value's key is a hash of its JSON, so equal values share it across islands and pages. A
 * navigation names the keys the browser holds (`F-Values`), and the server leaves those values out.
 *
 * Kept free of the store itself: the router and every isolated boundary import this module, and
 * only islands mode ships the store (`island-value-store.ts`).
 */

/** The element around a client component's server HTML. */
export const FARM_ISLAND_ELEMENT = "f-island";
/** The script type of an island's props; its `for` attribute names the island. */
export const FARM_PROPS_SCRIPT_TYPE = "f/props";
/** The script type of a value sent once; its `name` attribute is the value's key. */
export const FARM_VALUE_SCRIPT_TYPE = "f/value";
/** The element that keeps server output passed to an island as children. */
export const FARM_SLOT_ELEMENT = "f-slot";
/** The reserved JSON key whose value is a tag. */
export const FARM_TAG = "$";
/** The key of a tagged object's data. */
export const FARM_TAG_VALUE = "v";
export const FARM_REFERENCE_TAG = "r";
export const FARM_SLOT_TAG = "s";
export const FARM_ACTION_TAG = "a";
export const FARM_OBJECT_TAG = "o";
/** The request header listing the value keys the browser holds. */
export const FARM_VALUES_HEADER = "F-Values";

/** The tag of a tagged object (`{"$": tag}` or `{"$": tag, "v": data}`), or undefined. */
export function getFarmTag(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const tag = (value as Record<string, unknown>)[FARM_TAG];
  if (typeof tag !== "string") return undefined;
  const keys = Object.keys(value);
  return keys.length === 1 || (keys.length === 2 && FARM_TAG_VALUE in value) ? tag : undefined;
}

export const FARM_VALUE_KEY_PATTERN = /^[0-9a-z]{14}$/;
/** Keys sent per request: the most recently used ones. */
export const FARM_MAX_HELD_VALUES = 128;
/** Where the page's value store lives, shared by every copy of the runtime. */
export const FARM_ISLAND_VALUE_STORE_KEY = Symbol.for("farm.island-values");

/** The addressing a server installs (`installFarmIslandValues` in `island-values.ts`). */
export interface FarmIslandValuesServerHook {
  address(props: Record<string, unknown>): {
    json: string;
    values: Map<string, unknown>;
    roots: string[];
  };
  select(
    addressed: { json: string; values: Map<string, unknown>; roots: string[] },
    held: ReadonlySet<string> | null,
  ): Array<{ key: string; json: string }>;
  held(): ReadonlySet<string> | null;
  encodeLeaf(value: unknown): Record<string, unknown> | undefined;
  decode(object: Record<string, unknown>, decodeChild: (value: unknown) => unknown): unknown;
}

const ISLAND_VALUES_SERVER_KEY = Symbol.for("farm.island-values.server");

/**
 * @internal The value addressing this server installed, if any. Reached through a global so the
 * browser bundle never carries it.
 */
export function getFarmIslandValuesServer(): FarmIslandValuesServerHook | undefined {
  return (globalThis as typeof globalThis & Record<symbol, FarmIslandValuesServerHook | undefined>)[
    ISLAND_VALUES_SERVER_KEY
  ];
}

export interface FarmIslandValueStore {
  /** Reads the value scripts under `root` that the store does not hold yet. */
  ingest(root: ParentNode): void;
  /** Replaces value references in parsed props with the values they name. */
  resolve(value: unknown): unknown;
  /** The header value naming the keys the store holds, or undefined when it holds none. */
  heldHeader(): string | undefined;
}

/** Headers a navigation sends so the server can leave out values the browser holds. */
export function getFarmIslandValueHeaders(): Record<string, string> {
  const scope = globalThis as typeof globalThis & Record<symbol, FarmIslandValueStore | undefined>;
  const held = scope[FARM_ISLAND_VALUE_STORE_KEY]?.heldHeader();
  return held ? { [FARM_VALUES_HEADER]: held } : {};
}
