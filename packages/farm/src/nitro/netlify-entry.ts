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
 * app has answered, so it also overrides the `Cache-Control: private,
 * no-store` Farm sends for a request with cookies or an Authorization header.
 * Dropping that directive from private responses lets Netlify's CDN honor
 * `Cache-Control` and never serve one visitor's page to another.
 */
export function createFarmNetlifyEntry(options: { nitroNetlifyEntry: string }): string {
  return `
import nitroNetlifyHandler from ${JSON.stringify(options.nitroNetlifyEntry)};

const PRIVATE_CACHE_DIRECTIVE = /(?:^|,)\\s*(?:private|no-store)\\s*(?:[,=]|$)/i;

export default async function farmNetlifyHandler(request, context) {
  const response = await nitroNetlifyHandler(request, context);
  if (
    response &&
    response.headers.has("netlify-cdn-cache-control") &&
    PRIVATE_CACHE_DIRECTIVE.test(response.headers.get("cache-control") || "")
  ) {
    response.headers.delete("netlify-cdn-cache-control");
  }
  return response;
}
`.trim();
}
