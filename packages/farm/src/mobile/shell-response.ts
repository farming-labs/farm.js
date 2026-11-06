/**
 * Server side of bundled client assets (RFC 0004, 7.2): a web deployment of an app with a `mobile`
 * block also builds the mobile client, and answers the documents a mobile shell asks for with it.
 * Loaded by the generated server entry only when the build has a mobile client, so web apps
 * without one carry none of this.
 */
import { _withFarmGuardedResponseCache } from "../middleware/production-runtime";
import { _markFarmOwnedResponse, _withFarmResponseHeaders } from "../owned-response";

/**
 * The request header a mobile shell adds to the document loads it starts, with the OS as its
 * value (`android`, `ios`). Documents for such a request load the mobile client.
 */
export const FARM_SHELL_HEADER = "X-Farm-Shell";

/** What the server needs to point a document at the mobile client, from `mobile-client.json`. */
export interface FarmMobileShellClient {
  /** The web client entry as documents reference it, such as `/farm-client-h1a2b3c4d.js`. */
  webEntry: string;
  /** The mobile client entry that replaces it, such as `/farm-mobile-client-h5e6f7a8b.js`. */
  entry: string;
  /**
   * Web client files, without the leading slash, that the mobile client does not load. Their
   * modulepreload links are dropped from a shell's document; shared chunks keep theirs.
   */
  webOnly: string[];
}

/** True for a request a mobile shell started: `X-Farm-Shell` with a short lowercase OS name. */
export function isFarmMobileShellRequest(request: Request): boolean {
  const value = request.headers.get(FARM_SHELL_HEADER);
  return value !== null && /^[a-z][a-z0-9-]{0,31}$/.test(value);
}

function isHtml(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("text/html") === true;
}

function appendVary(headers: Headers, name: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", name);
    return;
  }
  const names = current.split(",").map((value) => value.trim().toLowerCase());
  if (names.includes("*") || names.includes(name.toLowerCase())) return;
  headers.set("Vary", `${current}, ${name}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How far back an unfinished tag is held for the next chunk; longer tags are passed through. */
const MAX_HELD_TAG = 4096;

/**
 * Rewrites a streamed HTML document for the mobile client: the web entry's URL becomes the mobile
 * entry's, and modulepreload links of web-only chunks are removed. Both live inside tags, so an
 * unfinished tag at the end of a chunk waits for the next one.
 */
export function createFarmMobileShellRewriter(
  client: FarmMobileShellClient,
): (text: string, final?: boolean) => string {
  const entry = new RegExp(`(["'])${escapeRegExp(client.webEntry)}\\1`, "g");
  const webOnly = new Set(client.webOnly);
  const preload = /<link rel="modulepreload" href="\/([^"]+)"[^>]*>/g;
  let held = "";
  return (text, final = false) => {
    let input = held + text;
    held = "";
    if (!final) {
      const open = input.lastIndexOf("<");
      if (open !== -1 && input.indexOf(">", open) === -1 && input.length - open <= MAX_HELD_TAG) {
        held = input.slice(open);
        input = input.slice(0, open);
      }
    }
    return input
      .replace(entry, (_match, quote: string) => `${quote}${client.entry}${quote}`)
      .replace(preload, (tag, file: string) => (webOnly.has(file) ? "" : tag));
  };
}

/**
 * Point a document at the mobile client when a mobile shell asked for it.
 *
 * HTML responses of an app with a mobile client always carry `Vary: X-Farm-Shell`, so a cache that
 * honors it never hands one variant to the other. A shell's document is also `private, no-store`
 * (as a guarded response is), so no shared cache stores it at all; `onPrivate` tells the adapter,
 * which keeps that policy under cache route rules. Anything other than HTML passes through.
 */
export function _applyFarmMobileShellClient(
  request: Request,
  response: Response,
  client: FarmMobileShellClient | null,
  onPrivate?: () => void,
): Response {
  if (!client || !isHtml(response)) return response;
  if (!isFarmMobileShellRequest(request) || !response.body) {
    return _withFarmResponseHeaders(response, (headers) => appendVary(headers, FARM_SHELL_HEADER));
  }
  onPrivate?.();
  const headers = new Headers(_withFarmGuardedResponseCache(response).headers);
  appendVary(headers, FARM_SHELL_HEADER);
  headers.delete("content-length");
  headers.delete("etag");
  const rewrite = createFarmMobileShellRewriter(client);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const output = rewrite(decoder.decode(chunk, { stream: true }));
        if (output) controller.enqueue(encoder.encode(output));
      },
      flush(controller) {
        const output = rewrite(decoder.decode(), true);
        if (output) controller.enqueue(encoder.encode(output));
      },
    }),
  );
  return _markFarmOwnedResponse(
    new Response(body, { status: response.status, statusText: response.statusText, headers }),
  );
}
