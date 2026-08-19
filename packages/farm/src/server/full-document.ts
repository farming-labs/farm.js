// Handling for a root layout that returns a full `<html>…</html>` document.
//
// Farm owns the document shell — a layout is expected to return a fragment (its
// children), like the docs example does. When a layout instead returns a whole
// document, the dev renderer must compose that document as the response rather
// than nesting it inside the generated shell, which would emit invalid nested
// `<html>`/`<head>`/`<body>`. This mirrors the production (Nitro) build's
// `hasFullDocument` path so dev and prod agree.

/** Peel Farm's leading `display:contents` wrapper divs (the stream root and any
 * layout-boundary divs) so the layout's own markup is exposed for inspection. */
function stripContentsWrappers(markup: string): string {
  let out = markup.replace(/^\s+/, "");
  const opener = /^<div\b[^>]*style="display\s*:\s*contents"[^>]*>/i;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(out))) {
    out = out.slice(match[0].length).replace(/^\s+/, "");
  }
  return out;
}

/**
 * When `markup` (a rendered layout tree, possibly wrapped in Farm's
 * `display:contents` boundary divs) is a full HTML document, return just that
 * `<html>…</html>` document (leading `<!DOCTYPE>` preserved when present);
 * otherwise return `null`.
 */
export function extractFarmFullDocument(markup: string): string | null {
  const inner = stripContentsWrappers(markup);
  if (!/^<!doctype/i.test(inner) && !/^<html[\s>]/i.test(inner)) return null;
  const start = markup.search(/<!doctype|<html[\s>]/i);
  const closeIndex = markup.toLowerCase().lastIndexOf("</html>");
  if (start < 0 || closeIndex < 0) return null;
  return markup.slice(start, closeIndex + "</html>".length);
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
  const inner = stripContentsWrappers(markup);
  return /^<!doctype/i.test(inner) || /^<html[\s>]/i.test(inner);
}

export interface FarmFullDocumentAssets {
  /** Farm-managed `<head>` markup (styles, client/runtime scripts, metadata). */
  headAssets: string;
  /** Markup injected just before `</body>` (client bootstrap / entry scripts). */
  bodyFooter: string;
  /** Extra `<html>` attributes to merge (theme, direction). */
  htmlAttributes?: string;
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
  let html = documentHtml;

  if (assets.htmlAttributes) {
    html = html.replace(
      /<html\b([^>]*)>/i,
      (_match, attrs: string) => `<html${attrs}${assets.htmlAttributes}>`,
    );
  }

  // Ensure a hydration root exists so the client can mount, matching the shell.
  if (!/\sid=["']root["']/i.test(html)) {
    html = html
      .replace(/<body\b([^>]*)>/i, '<body$1><div id="root">')
      .replace(/<\/body>/i, "</div></body>");
  }

  if (assets.headAssets) {
    html = html.replace(/<\/head>/i, () => `  ${assets.headAssets}\n</head>`);
  }
  if (assets.bodyFooter) {
    html = html.replace(/<\/body>/i, () => `  ${assets.bodyFooter}\n</body>`);
  }

  return /^\s*<!doctype/i.test(html) ? html : `<!DOCTYPE html>\n${html}`;
}
