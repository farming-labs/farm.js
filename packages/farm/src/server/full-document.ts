// Handling for a root layout that returns a full `<html>…</html>` document.
//
// A root layout may return its children (Farm then renders the document shell)
// or a whole document, as the create-app templates do. A whole document is
// composed as the response, with Farm's assets merged into it, rather than
// nested inside the generated shell, which would emit invalid nested
// `<html>`/`<head>`/`<body>`. This mirrors the production (Nitro) build's
// `hasFullDocument` path so dev and prod agree.

// Preact serializes the style with a trailing semicolon (`display:contents;`).
const CONTENTS_WRAPPER = /^<div\b[^>]*style="display\s*:\s*contents;?\s*"[^>]*>/i;

// React 19 hoists `<meta charSet>`, the viewport, preloads, titles, `<script async src>`, and
// `<style precedence>` (written as `data-precedence`). When the layout's `<html>` is not the
// render root, as when Farm's boundary divs wrap it, React writes them ahead of that markup
// instead of inside the layout's `<head>`. The production build embeds this same pattern.
export const HOISTED_HEAD_ELEMENT =
  /^(?:<(?:meta|link|base)\b[^>]*>|<title\b[^>]*>[\s\S]*?<\/title>|<script\b[^>]*\basync\b[^>]*><\/script>|<style\b[^>]*\bdata-precedence\b[^>]*>[\s\S]*?<\/style>)/i;

/** Peel Farm's leading `display:contents` wrapper divs (the stream root and any layout-boundary
 * divs) and the head elements React hoisted in front of them, so the layout's own markup is
 * exposed. The hoisted elements come back in order, to return to the document's head. */
function peelDocumentPrefix(markup: string): { inner: string; hoisted: string } {
  let inner = markup.replace(/^\s+/, "");
  let hoisted = "";
  let match: RegExpExecArray | null;
  while ((match = CONTENTS_WRAPPER.exec(inner) ?? HOISTED_HEAD_ELEMENT.exec(inner))) {
    if (!/^<div/i.test(match[0])) hoisted += match[0];
    inner = inner.slice(match[0].length).replace(/^\s+/, "");
  }
  return { inner, hoisted };
}

/** Put the head elements React hoisted out of a document back at the start of its `<head>`. */
function restoreHoistedHead(document: string, hoisted: string): string {
  if (!hoisted) return document;
  if (/<head[\s>]/i.test(document)) {
    return document.replace(/<head\b[^>]*>/i, (open) => open + hoisted);
  }
  return document.replace(/<html\b[^>]*>/i, (open) => `${open}<head>${hoisted}</head>`);
}

/**
 * When `markup` (a rendered layout tree, possibly wrapped in Farm's
 * `display:contents` boundary divs) is a full HTML document, return just that
 * `<html>…</html>` document (leading `<!DOCTYPE>` preserved when present);
 * otherwise return `null`.
 */
export function extractFarmFullDocument(markup: string): string | null {
  const { inner, hoisted } = peelDocumentPrefix(markup);
  if (!/^<!doctype/i.test(inner) && !/^<html[\s>]/i.test(inner)) return null;
  const start = markup.search(/<!doctype|<html[\s>]/i);
  const lower = markup.toLowerCase();
  let closeIndex = lower.lastIndexOf("</html>");
  // Keep the existing search for length-preserving case conversion. Unicode
  // such as İ expands when lowercased, so only then recover original offsets.
  if (lower.length !== markup.length) {
    closeIndex = -1;
    const closing = /<\/html>/gi;
    let match;
    while ((match = closing.exec(markup))) closeIndex = match.index;
  }
  if (start < 0 || closeIndex < 0) return null;
  const closeEnd = closeIndex + "</html>".length;
  let document = markup.slice(start, closeEnd);
  // React may flush Suspense reveal scripts after closing the app-authored
  // document and Farm's outer segment wrappers. Preserve that streamed tail
  // by moving it back inside the document body.
  const streamedTail = markup
    .slice(closeEnd)
    .replace(/^(?:\s*<\/div>)+/i, "")
    .trim();
  if (streamedTail) {
    document = document.replace(/<\/body>/i, () => `${streamedTail}</body>`);
  }
  return restoreHoistedHead(document, hoisted);
}

/** True when a rendered layout tree is (or wraps) a full HTML document. */
export function isFarmFullDocument(markup: string): boolean {
  return extractFarmFullDocument(markup) !== null;
}

/**
 * True when `markup` *begins* a full HTML document once Farm's wrappers are
 * peeled — usable on a streamed prefix, before the closing `</html>` has been
 * flushed.
 */
export function opensFarmFullDocument(markup: string): boolean {
  const { inner } = peelDocumentPrefix(markup);
  return /^<!doctype/i.test(inner) || /^<html[\s>]/i.test(inner);
}

/**
 * Classify a streamed prefix: it opens a full document, renders something else, or so far
 * holds only Farm's wrappers and hoisted head elements (React flushes those first, often as
 * a chunk of their own), so the next chunk decides.
 */
export function classifyFarmDocumentPrefix(markup: string): "document" | "fragment" | "pending" {
  const { inner } = peelDocumentPrefix(markup);
  if (/^<!doctype/i.test(inner) || /^<html[\s>]/i.test(inner)) return "document";
  return inner === "" ? "pending" : "fragment";
}

/**
 * Give a layout's document a `<head>` when it renders none. `<head>` is optional in
 * HTML and React, but Farm's managed head assets (route props, the client runtime,
 * styles) are inserted before `</head>`, and without one they would be dropped and
 * the page would never hydrate. Matches the production build's helper.
 */
export function ensureFarmDocumentHead(markup: string): string {
  if (/<head[\s>]/i.test(markup)) return markup;
  return markup.replace(/<html([^>]*)>/i, (_match, attributes: string) => {
    return `<html${attributes}><head></head>`;
  });
}

/**
 * Wrap the body's content in the `#root` element the client hydrates, unless the document
 * already has one. Matches the production build's helper.
 */
export function ensureFarmDocumentRoot(markup: string): string {
  // Only a #root that opens the body is the container; page content can have id="root" too, such
  // as a heading titled "Root".
  if (/<body\b[^>]*>\s*<div\b[^>]*\sid=["']root["']/i.test(markup)) return markup;
  return markup
    .replace(
      /<body\b([^>]*)>/i,
      (_match, attributes: string) => `<body${attributes}><div id="root">`,
    )
    .replace(/<\/body>/i, () => "</div></body>");
}

/** True when the markup already links a favicon. Matches the production build's helper. */
export function hasFarmDocumentIcon(markup: string): boolean {
  return /<link\b[^>]*\brel=["']?(?:shortcut )?icon\b/i.test(markup);
}

/** Remove document title elements before inserting a higher-priority title. */
export function removeFarmDocumentTitles(markup: string): string {
  return markup.replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/gi, "");
}

export interface FarmFullDocumentAssets {
  /** Farm-managed `<head>` markup (styles, client/runtime scripts, metadata). */
  headAssets: string;
  /** Markup injected just before `</body>` (client bootstrap / entry scripts). */
  bodyFooter: string;
  /** Extra `<html>` attributes to merge (theme, direction). */
  htmlAttributes?: string;
  /** Existing attributes Farm owns and must replace before merging. */
  replaceHtmlAttributes?: readonly string[];
  /**
   * Add `<link rel="icon" href="data:,">` unless the document already links an icon, so
   * the browser doesn't request a missing /favicon.ico. Matches the generated shell.
   */
  fallbackIcon?: boolean;
  /**
   * The route's viewport tags (renderMetadataHead's `viewport`), added at the start of the head
   * unless the document writes its own viewport tag.
   */
  viewport?: string;
}

/**
 * Start the head with `<meta charset>` and the viewport tags, as Next.js always renders both,
 * skipping each one the layout's document already writes (a viewport, theme-color, or
 * color-scheme tag of its own). The charset comes first because browsers only look for it in the
 * document's first 1024 bytes. The production server uses this same function.
 */
export function ensureFarmDocumentMeta(markup: string, viewport = ""): string {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(markup)?.[1] ?? "";
  const hasNamedMeta = (name: string) =>
    new RegExp(`<meta\\b[^>]*\\bname=["']?${name}(?=["'\\s/>])`, "i").test(head);
  const tags = [
    /<meta\b[^>]*\bcharset\s*=/i.test(head) ? "" : '<meta charset="utf-8">',
    ...(viewport.match(/<meta\b[^>]*>/gi) ?? []).filter((tag) => {
      const name = /\bname="([\w-]+)"/.exec(tag)?.[1];
      return !name || !hasNamedMeta(name);
    }),
  ].filter(Boolean);
  if (tags.length === 0) return markup;
  return markup.replace(/<head\b[^>]*>/i, (open) => `${open}${tags.join("")}`);
}

/**
 * Compose a layout's own full document with Farm's managed head + body assets,
 * instead of nesting it inside the shell. String replacements use function
 * replacers so any `$`-sequences (`$&`, `$'`, `$$`) in the injected markup or
 * the document are inserted literally rather than expanded.
 */
export function composeFarmFullDocument(
  documentHtml: string,
  assets: FarmFullDocumentAssets,
): string {
  let html = ensureFarmDocumentMeta(ensureFarmDocumentHead(documentHtml), assets.viewport);

  if (assets.htmlAttributes) {
    html = html.replace(/<html\b([^>]*)>/i, (_match, attrs: string) => {
      let nextAttributes = attrs;
      for (const name of assets.replaceHtmlAttributes ?? []) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        nextAttributes = nextAttributes.replace(
          new RegExp("\\s+" + escapedName + "=(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)", "gi"),
          "",
        );
      }
      return `<html${nextAttributes}${assets.htmlAttributes}>`;
    });
  }

  html = ensureFarmDocumentRoot(html);

  const headAssets = [
    assets.fallbackIcon && !hasFarmDocumentIcon(html) ? '<link rel="icon" href="data:,">' : "",
    assets.headAssets,
  ]
    .filter(Boolean)
    .join("\n  ");
  if (headAssets) {
    html = html.replace(/<\/head>/i, () => `  ${headAssets}\n</head>`);
  }
  if (assets.bodyFooter) {
    html = html.replace(/<\/body>/i, () => `  ${assets.bodyFooter}\n</body>`);
  }

  return /^\s*<!doctype/i.test(html) ? html : `<!DOCTYPE html>\n${html}`;
}
