import { localizeFarmPathname, type FarmLocalePathConfig } from "./routing";

export interface FarmLocaleAlternateLinkOptions {
  /**
   * The route's `metadataBase`. Preferred over the request origin when it is an
   * absolute http(s) URL, so every alternate advertises the app's canonical host.
   */
  metadataBase?: unknown;
  /**
   * The trusted request origin (`server.trustProxy` decides whether forwarded
   * authority headers count). Used when no usable `metadataBase` is set.
   */
  origin?: string;
}

/**
 * Render `<link rel="alternate" hreflang>` tags for every configured locale plus
 * `x-default`. Search engines ignore relative hreflang URLs, so each href is
 * resolved against `metadataBase`, otherwise against the request origin. With
 * neither available the localized path is emitted as-is.
 */
export function renderFarmLocaleAlternateLinks(
  pathname: string,
  config: FarmLocalePathConfig,
  options: FarmLocaleAlternateLinkOptions = {},
): string {
  if (config.routing === "none") return "";
  const base = resolveAlternateBase(options);
  const link = (hreflang: string, locale: string) =>
    `<link rel="alternate" hreflang="${escapeHtmlAttribute(hreflang)}" href="${escapeHtmlAttribute(
      resolveAlternateHref(localizeFarmPathname(pathname, locale, config), base),
    )}">`;
  const links = config.locales.map((locale) => link(locale, locale));
  links.push(link("x-default", config.defaultLocale));
  return links.join("");
}

function resolveAlternateBase(options: FarmLocaleAlternateLinkOptions): URL | undefined {
  for (const candidate of [options.metadataBase, options.origin]) {
    if (typeof candidate !== "string" && !(candidate instanceof URL)) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      // A relative or malformed metadataBase falls through to the request origin.
    }
  }
  return undefined;
}

function resolveAlternateHref(pathname: string, base: URL | undefined): string {
  if (!base) return pathname;
  // A leading `//` or `\` would make the path an authority and move the
  // alternate off the base host, so it is collapsed to one slash first.
  return new URL(pathname.replace(/^[/\\]+/, "/"), base).href;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
