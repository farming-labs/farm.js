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
function peelDocumentPrefix(markup: string): {
  inner: string;
  hoisted: string;
  layoutPatterns: string[];
} {
  let inner = markup.replace(/^\s+/, "");
  let hoisted = "";
  const layoutPatterns: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = CONTENTS_WRAPPER.exec(inner) ?? HOISTED_HEAD_ELEMENT.exec(inner))) {
    if (!/^<div/i.test(match[0])) hoisted += match[0];
    else {
      const pattern = /\sdata-farm-layout-pattern="([^"]*)"/i.exec(match[0])?.[1];
      if (pattern !== undefined) layoutPatterns.push(pattern);
    }
    inner = inner.slice(match[0].length).replace(/^\s+/, "");
  }
  return { inner, hoisted, layoutPatterns };
}

/** Keep the requested outlet and any resources React hoisted before the layout boundaries. */
export function takeFarmNavigationOutlet(markup: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = markup.indexOf(open);
  if (start === -1) return markup;
  const end = markup.indexOf(close, start + open.length);
  // An ancestor can show the outlet twice. Keep its layout in that case.
  if (end === -1 || markup.includes(open, end + close.length)) {
    return markup.split(open).join("").split(close).join("");
  }
  return peelDocumentPrefix(markup).hoisted + markup.slice(start + open.length, end);
}

/**
 * Name, on its `<html>`, each layout whose boundary div wraps a rendered document. Such a layout
 * renders the document itself, so the page has no boundary element for it: development client
 * navigation reads this to know the layout is already there, keeping it and swapping only what
 * changes instead of nesting a second copy of the layout inside the page. Markup that is not a
 * document comes back unchanged.
 */
export function markFarmDocumentLayouts(markup: string): string {
  const { inner, layoutPatterns } = peelDocumentPrefix(markup);
  if (layoutPatterns.length === 0) return markup;
  const html = /^(?:<!doctype[^>]*>\s*)?<html\b/i.exec(inner);
  if (!html) return markup;
  const value = JSON.stringify(layoutPatterns).replace(/&/g, "&amp;").replace(/'/g, "&#39;");
  const at = markup.length - inner.length + html[0].length;
  return `${markup.slice(0, at)} data-farm-document-layouts='${value}'${markup.slice(at)}`;
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
 * Split the head elements a component renders (`<meta>`, `<title>`, preloads) off the front of
 * a render that is not a full document. React writes them ahead of everything else when its root
 * is not `<html>`; they belong in the document's head, where React puts them when it renders the
 * document itself. A full document is returned whole: its own head takes them.
 *
 * With `complete` false, `markup` is a streamed prefix, and null means the next chunk decides.
 */
export function takeFarmHoistedHead(
  markup: string,
  complete: boolean,
): { head: string; body: string } | null {
  const kind = classifyFarmDocumentPrefix(markup);
  if (kind === "document") return { head: "", body: markup };
  if (kind === "pending" && !complete) return null;
  let head = "";
  let body = markup;
  let match: RegExpExecArray | null;
  while ((match = HOISTED_HEAD_ELEMENT.exec(body.replace(/^\s+/, "")))) {
    head += match[0];
    body = body.replace(/^\s+/, "").slice(match[0].length);
  }
  if (!complete && endsInsideHoistable(body)) return null;
  return { head, body };
}

// A head element the stream cut in two: its tag, or its text and closing tag, is still coming.
function endsInsideHoistable(body: string): boolean {
  const open = /^\s*<(meta|link|base|title|script|style)\b/i.exec(body);
  if (!open) return false;
  const tag = open[1]!.toLowerCase();
  if (!body.includes(">")) return true;
  return (
    (tag === "title" || tag === "script" || tag === "style") &&
    !new RegExp(`</${tag}>`, "i").test(body)
  );
}

/** Put head elements taken from a render at the end of a document's `<head>`. */
export function appendFarmHead(document: string, head: string): string {
  if (!head) return document;
  return document.replace(/<\/head>/i, () => `${head}\n</head>`);
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

const STREAMED_BODY_MARK = "<!--farm-streamed-body-->";

/**
 * The opening of a streamed full document: React's output up to (and including) its `<body>`,
 * composed with Farm's assets like a buffered document. `rootOpened` says whether Farm opened
 * `#root` (the layout's body does not), which the stream's footer then closes.
 */
export function openFarmStreamedDocument(
  opening: string,
  assets: FarmFullDocumentAssets,
): { html: string; rootOpened: boolean } {
  const { hoisted } = peelDocumentPrefix(opening);
  const start = opening.search(/<!doctype|<html[\s>]/i);
  const document = restoreHoistedHead(opening.slice(Math.max(start, 0)), hoisted);
  const rootOpened = !/<body\b[^>]*>\s*<div\b[^>]*\sid=["']root["']/i.test(document);
  // Compose the whole document around a mark where the streamed body continues.
  const composed = composeFarmFullDocument(
    `${document}${STREAMED_BODY_MARK}</body></html>`,
    assets,
  );
  return { html: composed.slice(0, composed.indexOf(STREAMED_BODY_MARK)), rootOpened };
}

/**
 * Streams a layout's own `<html>` document: holds React's output until `<body>`, opens the
 * document with `open`, then passes the body through. React's closing `</body></html>` (and
 * Farm's wrapper `</div>`s after it) is dropped: Suspense content React streams later belongs
 * inside the body, before the footer the caller writes. The production entry does the same
 * (`createFarmFullDocumentStream`).
 *
 * A route expected to render a document may not (its layout changed): output that starts as a
 * fragment goes out after `fragmentShell`, Farm's usual shell, and `end()` reports `fragment`.
 */
export function createFarmStreamedDocumentTransform(
  open: (opening: string) => { html: string; rootOpened: boolean },
  fragmentShell: string,
): {
  write(text: string): string;
  end(): { text: string; document: boolean; rootOpened: boolean };
} {
  let opening = "";
  let mode: "pending" | "document" | "fragment" = "pending";
  let opened = false;
  let closed = false;
  let rootOpened = false;
  const write = (text: string): string => {
    if (mode === "fragment") return text;
    if (!opened) {
      opening += text;
      if (mode === "pending") {
        const prefix = classifyFarmDocumentPrefix(opening);
        if (prefix === "pending") return "";
        if (prefix === "fragment") {
          mode = "fragment";
          const held = opening;
          opening = "";
          return fragmentShell + held;
        }
        mode = "document";
      }
      if (!/<body\b[^>]*>/i.test(opening)) return "";
      opened = true;
      text = opening;
      opening = "";
      const closeAt = text.search(/<\/body>/i);
      const head = closeAt >= 0 ? text.slice(0, closeAt) : text;
      const document = open(head);
      rootOpened = document.rootOpened;
      text = document.html + (closeAt >= 0 ? text.slice(closeAt) : "");
    }
    if (!closed) {
      const closeAt = text.search(/<\/body>/i);
      if (closeAt >= 0) {
        closed = true;
        text =
          text.slice(0, closeAt) +
          text.slice(closeAt).replace(/^<\/body>\s*(?:<\/html>)?(?:\s*<\/div>)*/i, "");
      }
    }
    return text;
  };
  return {
    write,
    end() {
      if (mode === "pending") {
        // Too little output to tell: it is no document.
        mode = "fragment";
        const held = opening;
        opening = "";
        return { text: fragmentShell + held, document: false, rootOpened: false };
      }
      if (mode === "fragment") return { text: "", document: false, rootOpened: false };
      if (opened) return { text: "", document: true, rootOpened };
      // A document that never reached <body> still opens, so the footer lands in a document.
      const held = opening;
      opening = "";
      const text = write(`${held}<body>`);
      return { text, document: true, rootOpened };
    },
  };
}
