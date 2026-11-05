import { getSharedLayoutPrefixLength, parseFarmLayoutChainHeader } from "./render-plan";

/**
 * Islands mode's navigation protocol on the server (RFC 0003), for `farm dev`. The production
 * server runs the same functions from its generated source (`FARM_SEGMENT_NAVIGATION_SERVER_RUNTIME`
 * and `createFarmFlushToken` in nitro/universal-build.ts); a test keeps the two equal.
 *
 * - A client navigation names the layouts the browser shows in `F-Layouts`, by key: the pattern
 *   with its params filled in, so a layout whose params change renders again. The response sends a
 *   kept layout as its empty boundary.
 * - `F-Stream: flush` asks for a marker after each React flush, so the browser shows the page
 *   before its Suspense content arrives. The marker carries a random token sent in the `F-Flush`
 *   header, so page content cannot forge one.
 */

export type FarmLayoutParams = Record<string, string | string[] | undefined>;

/** The layout's key: its pattern with the route's params filled in. */
export function getFarmLayoutKey(pattern: string, params?: FarmLayoutParams): string {
  return pattern.replace(
    /\[\[?\.\.\.([^\]]+)\]?\]|\[([^\]]+)\]/g,
    (_match, rest: string | undefined, name: string | undefined) => {
      const value = params ? params[(rest || name)!] : undefined;
      if (Array.isArray(value)) return value.map(encodeURIComponent).join("/");
      return value === undefined ? "" : encodeURIComponent(String(value));
    },
  );
}

/**
 * How many leading layouts the navigating browser keeps (`F-Layouts`). Keeping one keeps nothing:
 * the root layout always renders, since it may own the document.
 */
export function countFarmKeptLayouts(
  layoutsHeader: string | null | undefined,
  layouts: ReadonlyArray<{ pattern: string }>,
  params?: FarmLayoutParams,
): number {
  const chain = parseFarmLayoutChainHeader(layoutsHeader ?? null);
  if (chain.length === 0) return 0;
  const keys = layouts.map((layout) => getFarmLayoutKey(layout.pattern, params));
  if (chain[0] === keys[0]) return getSharedLayoutPrefixLength(chain, keys);
  // A root layout that renders the document itself leaves no boundary in the page, so the
  // browser's chain starts at the next layout.
  return keys.length > 1 ? 1 + getSharedLayoutPrefixLength(chain, keys.slice(1)) : 0;
}

/** A streamed navigation's flush marker token: 128 random bits, hex. */
export function createFarmFlushToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let token = "";
  for (const byte of bytes) token += byte.toString(16).padStart(2, "0");
  return token;
}

/** The comment written after each React flush of a streamed navigation. */
export function farmFlushMarker(token: string): string {
  return `<!--farm-flush:${token}-->`;
}
