/**
 * The wire protocol of content-addressed island values (RFC 0003). A large prop value arrives once,
 * in a `<script type="application/json" data-farm-value="key">`, and islands reference it as
 * `{"$farmValue":"key"}`. The key is a hash of the value's JSON, so equal values share it across
 * islands and pages. A navigation sends the keys the browser holds, and the server leaves those
 * values out.
 *
 * Kept free of the store itself: the router and every isolated boundary import this module, and
 * only islands mode ships the store (`island-value-store.ts`).
 */

export const FARM_VALUE_ATTRIBUTE = "data-farm-value";
export const FARM_VALUE_REFERENCE = "$farmValue";
/** The request header listing the value keys the browser holds. */
export const FARM_VALUES_HEADER = "x-farm-values";
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
