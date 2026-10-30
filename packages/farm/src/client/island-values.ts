/**
 * The server side of content-addressed island values (RFC 0003): which parts of an island's props
 * travel as values of their own, and which of those a response leaves out because the browser
 * already holds them. See `island-value-protocol.ts` for
 * the wire format and `island-value-store.ts` for the browser side.
 */
import { setRenderStateResolver } from "@farm.js/islx/react/server";
import { _resolveCurrentRequest, _resolveCurrentRequestForApp } from "../server/request-bridge";
import { decodeFarmTagged, encodeFarmLeaf } from "./island-codec";
import {
  FARM_MAX_HELD_VALUES,
  FARM_VALUE_KEY_PATTERN,
  FARM_REFERENCE_TAG,
  FARM_VALUES_HEADER,
} from "./island-value-protocol";

/** Shorter values stay inline: a reference and its script cost about 60 bytes. */
export const FARM_VALUE_MIN_LENGTH = 512;

/** A 64-bit hash of a value's JSON, as 14 base-36 characters. Not cryptographic. */
export function hashFarmValue(json: string): string {
  let h1 = 0xdeadbeef ^ json.length;
  let h2 = 0x41c6ce57 ^ json.length;
  for (let index = 0; index < json.length; index++) {
    const code = json.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36).padStart(7, "0") + (h1 >>> 0).toString(36).padStart(7, "0");
}

export interface FarmAddressedValue {
  key: string;
  json: string;
  /** Keys of the values this value's JSON refers to. */
  children: string[];
}

export interface FarmAddressedProps {
  /** The props as JSON, with each large value replaced by a reference. */
  json: string;
  values: Map<string, FarmAddressedValue>;
  /** Keys the props refer to directly. */
  roots: string[];
}

/**
 * Serializes plain-data props with every value whose JSON reaches `FARM_VALUE_MIN_LENGTH` replaced
 * by a reference to it. Inner values are addressed first, so a large value that differs between
 * pages in one place still shares its unchanged parts.
 */
export function addressFarmValues(
  props: Record<string, unknown>,
  minLength = FARM_VALUE_MIN_LENGTH,
): FarmAddressedProps {
  const values = new Map<string, FarmAddressedValue>();
  const reference = (json: string, children: string[], parent: string[]) => {
    const key = hashFarmValue(json);
    if (!values.has(key)) values.set(key, { key, json, children });
    parent.push(key);
    return `{"$":"${FARM_REFERENCE_TAG}","v":"${key}"}`;
  };
  // Returns the value's JSON with large inner values replaced, and the length of its full JSON:
  // a value is addressed by its full size, so a tree whose parts are all addressed still gets one
  // key of its own.
  const encode = (value: unknown, parent: string[]): [json: string, length: number] => {
    if (value === null || typeof value !== "object") {
      const json = JSON.stringify(value);
      return [
        typeof value === "string" && json.length >= minLength ? reference(json, [], parent) : json,
        json.length,
      ];
    }
    const own: string[] = [];
    let length = 2;
    const parts: string[] = [];
    if (Array.isArray(value)) {
      for (const entry of value) {
        const [json, entryLength] = encode(entry, own);
        parts.push(json);
        length += entryLength + 1;
      }
    } else {
      for (const [key, entry] of Object.entries(value)) {
        const [json, entryLength] = encode(entry, own);
        const name = JSON.stringify(key);
        parts.push(`${name}:${json}`);
        length += name.length + entryLength + 2;
      }
    }
    const json = Array.isArray(value) ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
    // A thin wrapper around one addressed value is not worth a key and a script of its own.
    const wrapper = own.length === 1 && json.length < minLength / 4;
    if (length >= minLength && !wrapper) return [reference(json, own, parent), length];
    parent.push(...own);
    return [json, length];
  };
  const roots: string[] = [];
  const json = `{${Object.entries(props)
    .map(([key, entry]) => `${JSON.stringify(key)}:${encode(entry, roots)[0]}`)
    .join(",")}}`;
  return { json, values, roots };
}

/**
 * The values a response sends for `addressed`, parents first. A value the browser holds is left
 * out with everything inside it: the browser kept those when it read the value.
 */
export function selectFarmValuesToSend(
  addressed: FarmAddressedProps,
  held: ReadonlySet<string> | null,
): FarmAddressedValue[] {
  const send: FarmAddressedValue[] = [];
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    if (held?.has(key)) return;
    const value = addressed.values.get(key)!;
    send.push(value);
    value.children.forEach(visit);
  };
  addressed.roots.forEach(visit);
  return send;
}

export function parseFarmHeldValues(header: string | null | undefined): ReadonlySet<string> {
  const held = new Set<string>();
  if (!header) return held;
  for (const key of header.split(",", FARM_MAX_HELD_VALUES * 2)) {
    const trimmed = key.trim();
    if (FARM_VALUE_KEY_PATTERN.test(trimmed)) held.add(trimmed);
    if (held.size === FARM_MAX_HELD_VALUES) break;
  }
  return held;
}

const heldByRequest = new WeakMap<Request, ReadonlySet<string>>();
const ignoredRequests = new WeakSet<Request>();

/**
 * Makes the current request's render send every value, whatever the browser holds: its HTML may
 * be stored in a shared cache (a PPR shell, an ISR entry) and served to browsers that hold none.
 */
export function ignoreFarmHeldValues(): void {
  const request = _resolveCurrentRequest();
  if (request) ignoredRequests.add(request);
}

/**
 * The value keys the browser making the current request holds, or null outside a request or
 * when it holds none.
 */
export function readFarmHeldValues(): ReadonlySet<string> | null {
  const request = _resolveCurrentRequest();
  if (!request || ignoredRequests.has(request)) return null;
  let held = heldByRequest.get(request);
  if (!held) {
    held = parseFarmHeldValues(request.headers.get(FARM_VALUES_HEADER));
    heldByRequest.set(request, held);
    // HTML that leaves values out is one browser's: count it as a request read, so it never
    // enters a shared PPR shell, ISR entry, or CDN response.
    if (held.size > 0) void _resolveCurrentRequestForApp()?.headers;
  }
  return held.size > 0 ? held : null;
}

export interface FarmIslandValuesServer {
  address: typeof addressFarmValues;
  select: typeof selectFarmValuesToSend;
  held: typeof readFarmHeldValues;
  /** Markers for values JSON cannot hold (`island-codec.ts`). */
  encodeLeaf: typeof encodeFarmLeaf;
  decode: typeof decodeFarmTagged;
}

const SERVER_KEY = Symbol.for("farm.island-values.server");

/**
 * Gives island boundaries rendered on this server their value addressing. Boundaries reach it
 * through a global, so the browser bundle never carries it.
 */
const sentByRequest = new WeakMap<Request, Set<string>>();

export function installFarmIslandValues(): void {
  // islx renders islands mode's islands: it reads the values this request's browser holds, and
  // which this response already wrote, from Farm's request.
  setRenderStateResolver(() => {
    const request = _resolveCurrentRequest();
    if (!request) return null;
    let sent = sentByRequest.get(request);
    if (!sent) sentByRequest.set(request, (sent = new Set()));
    return { held: readFarmHeldValues(), sent };
  });
  (globalThis as typeof globalThis & Record<symbol, FarmIslandValuesServer>)[SERVER_KEY] = {
    address: addressFarmValues,
    select: selectFarmValuesToSend,
    held: readFarmHeldValues,
    encodeLeaf: encodeFarmLeaf,
    decode: decodeFarmTagged,
  };
}

/** @internal The addressing a server installed, if any. */
export function getFarmIslandValuesServer(): FarmIslandValuesServer | undefined {
  return (globalThis as typeof globalThis & Record<symbol, FarmIslandValuesServer | undefined>)[
    SERVER_KEY
  ];
}
