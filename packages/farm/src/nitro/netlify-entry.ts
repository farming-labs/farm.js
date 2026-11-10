import { existsSync } from "node:fs";
import path from "node:path";

/** Nitro's Netlify function entry, next to the Nitro runtime entry in the installed package. */
export function resolveNitroNetlifyEntry(nitroRuntimeEntry: string): string {
  const entry = path.join(
    path.dirname(nitroRuntimeEntry),
    "..",
    "presets",
    "netlify",
    "runtime",
    "netlify.mjs",
  );
  if (!existsSync(entry)) {
    throw new Error(
      `[Farm.js] Could not find Nitro's Netlify function entry at ${entry}. Farm wraps it so ` +
        "private responses are never cached by Netlify's CDN; reinstall dependencies or report " +
        "the installed Nitro version.",
    );
  }
  return entry.split(path.sep).join("/");
}

/**
 * Generate the Netlify function entry. Nitro's entry sets a public, durable
 * `Netlify-CDN-Cache-Control` on every response of an `isr` route, after the
 * app has answered, and a public `Cache-Control` when the app sent none. That
 * includes a page Farm marks `private, no-store`, an API response read with the
 * caller's cookies, a guard's 401 or redirect, and an error, so Netlify's CDN
 * would serve one visitor's response to the next. The wrapper keeps the
 * directive only for what a shared cache may store: an anonymous request (no
 * Cookie or Authorization) answered 200 without Set-Cookie, a private
 * Cache-Control or a Vary on credentials. Otherwise it drops the directive and
 * replaces Nitro's own public Cache-Control with `private, no-store`.
 */
export function createFarmNetlifyEntry(options: { nitroNetlifyEntry: string }): string {
  return `
import nitroNetlifyHandler from ${JSON.stringify(options.nitroNetlifyEntry)};

const PRIVATE_CACHE_DIRECTIVE = /(?:^|,)\\s*(?:private|no-store)\\s*(?:[,=]|$)/i;
const CREDENTIAL_VARY = /(?:^|,)\\s*(?:\\*|cookie|authorization)\\s*(?:,|$)/i;
// What Nitro's entry sets when the response has no Cache-Control of its own.
const NITRO_DEFAULT_CACHE_CONTROL = "public, max-age=0, must-revalidate";

function isSharedCacheable(request, response) {
  return (
    response.status === 200 &&
    !request.headers.has("cookie") &&
    !request.headers.has("authorization") &&
    !response.headers.has("set-cookie") &&
    !PRIVATE_CACHE_DIRECTIVE.test(response.headers.get("cache-control") || "") &&
    !CREDENTIAL_VARY.test(response.headers.get("vary") || "")
  );
}

export default async function farmNetlifyHandler(request, context) {
  const response = await nitroNetlifyHandler(request, context);
  if (
    response &&
    response.headers.has("netlify-cdn-cache-control") &&
    !isSharedCacheable(request, response)
  ) {
    response.headers.delete("netlify-cdn-cache-control");
    if (response.headers.get("cache-control") === NITRO_DEFAULT_CACHE_CONTROL) {
      response.headers.set("cache-control", "private, no-store");
    }
  }
  return response;
}
`.trim();
}
