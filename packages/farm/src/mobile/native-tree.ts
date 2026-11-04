/**
 * The native tier's screen data: a rendered page as a tree of native views. The shell asks for a
 * page with `Accept: application/vnd.farm.native+json`; the server renders it as it would for a
 * browser, reads the HTML, and answers with the tree, so a page's server data, async components,
 * and auth behave as on the web. Only pages the analyzer puts in the native tier are asked for;
 * anything the tree cannot express comes back in `unsupported`, and the shell then shows the
 * page's web screen instead.
 */
import { _readFarmRenderedHtml } from "../markdown";
import {
  cascadeFarmNativeStylesheets,
  parseFarmNativeStylesheet,
  type FarmNativeCssElement,
  type FarmNativeStylesheet,
} from "./native-css";
import {
  FARM_NATIVE_TEXT_KEYS,
  resolveFarmNativeClasses,
  resolveFarmNativeInlineStyle,
  type FarmNativeStyle,
} from "./native-style";

import { FARM_NATIVE_TREE_CONTENT_TYPE } from "./native-tree-type";

export { FARM_NATIVE_TREE_CONTENT_TYPE };

export type FarmNativeNodeType = "View" | "Text" | "Image" | "Pressable" | "TextInput";

export interface FarmNativeNode {
  type: FarmNativeNodeType;
  /** The HTML tag it came from, for debugging. */
  tag: string;
  style?: FarmNativeStyle;
  /** `dark:` overrides of `style`. */
  dark?: FarmNativeStyle;
  /** Text and inline runs of a `Text`. A run is a nested `Text`, such as a link or `<strong>`. */
  children?: Array<FarmNativeNode | string>;
  /** Absolute URL a `Pressable` (or a link run) opens. */
  href?: string;
  /** Absolute URL of an `Image`. */
  src?: string;
  alt?: string;
  placeholder?: string;
  value?: string;
}

export interface FarmNativeTree {
  version: 1;
  title?: string;
  root: FarmNativeNode;
  /** What the tree could not express. A shell shows the web screen when this is not empty. */
  unsupported: string[];
}

const VIEW_TAGS = new Set(
  "div section main article header footer nav aside figure ul ol li hr".split(" "),
);
const BLOCK_TEXT_TAGS = new Set("p h1 h2 h3 h4 h5 h6".split(" "));
const INLINE_TAGS = new Set("span strong em b i small label code br a".split(" "));
const VOID_TAGS = new Set(
  "area base br col embed hr img input link meta source track wbr".split(" "),
);
const SKIPPED_TAGS = new Set("link meta template title".split(" "));
// Browser defaults a Tailwind preflight keeps, applied to inline runs.
const INLINE_DEFAULTS: Record<string, FarmNativeStyle> = {
  strong: { fontWeight: 700 },
  b: { fontWeight: 700 },
  em: { fontStyle: "italic" },
  i: { fontStyle: "italic" },
  code: { fontFamily: "mono" },
};

interface HtmlElement extends FarmNativeCssElement {
  children: Array<HtmlElement | string>;
  parent?: HtmlElement;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** Parse markup React rendered: well-formed, double-quoted attributes, void elements unclosed. */
function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { tag: "#root", attributes: {}, children: [] };
  const stack = [root];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    if (match.index > cursor) stack.at(-1)!.children.push(decode(html.slice(cursor, match.index)));
    cursor = tag.lastIndex;
    const name = match[2]!.toLowerCase();
    if (match[1]) {
      let open = stack.length - 1;
      while (open > 0 && stack[open]!.tag !== name) open -= 1;
      if (open > 0) stack.length = open;
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const attribute of match[3]!.matchAll(
      /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
    )) {
      attributes[attribute[1]!.toLowerCase()] = decode(
        attribute[2] ?? attribute[3] ?? attribute[4] ?? "",
      );
    }
    const parent = stack.at(-1)!;
    let previous: HtmlElement | undefined;
    for (let index = parent.children.length - 1; index >= 0 && !previous; index -= 1) {
      const child = parent.children[index]!;
      if (typeof child !== "string") previous = child;
    }
    const element: HtmlElement = { tag: name, attributes, children: [], parent, previous };
    parent.children.push(element);
    if (!match[4] && !VOID_TAGS.has(name)) stack.push(element);
  }
  if (cursor < html.length) stack.at(-1)!.children.push(decode(html.slice(cursor)));
  const markLast = (element: HtmlElement) => {
    const elements = element.children.filter(
      (child): child is HtmlElement => typeof child !== "string",
    );
    const last = elements[elements.length - 1];
    if (last) last.last = true;
    elements.forEach(markLast);
  };
  markLast(root);
  return root;
}

function find(
  element: HtmlElement,
  test: (element: HtmlElement) => boolean,
): HtmlElement | undefined {
  if (test(element)) return element;
  for (const child of element.children) {
    if (typeof child === "string") continue;
    const found = find(child, test);
    if (found) return found;
  }
  return undefined;
}

interface Inherited {
  style: FarmNativeStyle;
  dark: FarmNativeStyle;
}

function textOnly(style: FarmNativeStyle): FarmNativeStyle {
  return Object.fromEntries(
    Object.entries(style).filter(([key]) => FARM_NATIVE_TEXT_KEYS.has(key)),
  );
}

function withoutText(style: FarmNativeStyle): FarmNativeStyle | undefined {
  const rest = Object.entries(style).filter(([key]) => !FARM_NATIVE_TEXT_KEYS.has(key));
  return rest.length > 0 ? Object.fromEntries(rest) : undefined;
}

/** `leading-*` wins over a size's line height; a scale is relative to the font size. */
function settleLineHeight(style: FarmNativeStyle): FarmNativeStyle {
  const { lineHeightScale, lineHeightPx, ...rest } = style;
  if (lineHeightPx !== undefined) rest.lineHeight = lineHeightPx;
  else if (typeof lineHeightScale === "number") {
    rest.lineHeight = Math.round(lineHeightScale * Number(rest.fontSize ?? 16) * 100) / 100;
  }
  return rest;
}

class Converter {
  readonly unsupported: string[] = [];

  /** Off while reading the ancestors above the page, which pass down text styles only. */
  reporting = true;

  /**
   * `sheets`: the page's stylesheets. Without them, a class the Tailwind table does not know is
   * reported; with them, only one a layered (Tailwind) rule styles is, since a class no rule
   * styles has no effect in a browser either.
   */
  constructor(
    private readonly pageUrl: URL,
    private readonly sheets?: readonly FarmNativeStylesheet[],
  ) {}

  private problem(message: string) {
    if (this.reporting && !this.unsupported.includes(message)) this.unsupported.push(message);
  }

  stylesOf(element: HtmlElement): { style: FarmNativeStyle; dark: FarmNativeStyle } {
    const classes = resolveFarmNativeClasses(element.attributes.class ?? "");
    const cascade = this.sheets ? cascadeFarmNativeStylesheets(this.sheets, element) : undefined;
    for (const token of classes.unsupported) {
      if (!cascade || cascade.layered.includes(token.split(":").pop()!)) {
        this.problem(`<${element.tag}> class "${token}"`);
      }
    }
    for (const problem of cascade?.unsupported ?? []) {
      this.problem(`<${element.tag}> ${problem}`);
    }
    const inline = resolveFarmNativeInlineStyle(element.attributes.style ?? "");
    for (const declaration of inline.unsupported) {
      this.problem(`<${element.tag}> style "${declaration}"`);
    }
    // Browser defaults, then Tailwind's utilities, then the app's own rules, then the attribute.
    const style = {
      ...INLINE_DEFAULTS[element.tag],
      ...classes.style,
      ...cascade?.style,
      ...inline.style,
    };
    const dark = { ...classes.dark, ...cascade?.dark };
    // CSS flex lays out in a row unless told otherwise.
    for (const target of [style, dark]) {
      if (target.display === "flex" && target.flexDirection === undefined && !style.flexDirection) {
        target.flexDirection = "row";
      }
    }
    return { style, dark };
  }

  private url(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
      return new URL(value, this.pageUrl).href;
    } catch {
      this.problem(`URL "${value}"`);
      return undefined;
    }
  }

  private node(
    type: FarmNativeNodeType,
    element: HtmlElement,
    style: FarmNativeStyle | undefined,
    dark: FarmNativeStyle | undefined,
  ): FarmNativeNode {
    return {
      type,
      tag: element.tag,
      ...(style && Object.keys(style).length > 0 ? { style } : {}),
      ...(dark && Object.keys(dark).length > 0 ? { dark } : {}),
    };
  }

  /** Inline content: runs of text, nested inline elements, and line breaks. */
  private inline(
    content: Array<HtmlElement | string>,
    inherited: Inherited,
  ): Array<FarmNativeNode | string> {
    const runs: Array<FarmNativeNode | string> = [];
    for (const child of content) {
      if (typeof child === "string") {
        runs.push(child);
        continue;
      }
      if (SKIPPED_TAGS.has(child.tag)) continue;
      if (child.tag === "br") {
        runs.push("\n");
        continue;
      }
      if (!INLINE_TAGS.has(child.tag)) {
        this.problem(`<${child.tag}> inside text`);
        continue;
      }
      const own = this.stylesOf(child);
      if (own.style.display === "none") continue;
      const run = this.node(
        "Text",
        child,
        settleLineHeight(textOnly(own.style)),
        textOnly(own.dark),
      );
      if (withoutText(own.style)) this.problem(`<${child.tag}> inside text has box styles`);
      if (child.tag === "a") run.href = this.url(child.attributes.href);
      const children = this.inline(child.children, inherited);
      if (children.length > 0) run.children = children;
      runs.push(run);
    }
    return runs;
  }

  /** A text block: its runs, with the text style its ancestors pass down. */
  private text(
    element: HtmlElement,
    content: Array<HtmlElement | string>,
    inherited: Inherited,
    box?: { style: FarmNativeStyle; dark: FarmNativeStyle },
  ): FarmNativeNode | undefined {
    const runs = this.inline(content, inherited);
    const trimmed = collapse(runs);
    if (trimmed.length === 0) return undefined;
    const style = settleLineHeight({ ...inherited.style, ...box?.style });
    const dark = { ...inherited.dark, ...box?.dark };
    const node = this.node("Text", element, style, dark);
    node.children = trimmed;
    return node;
  }

  /** A link drawn as a box: it holds blocks, or has a box style such as a background. */
  private isBlockLink(element: HtmlElement): boolean {
    if (element.tag !== "a") return false;
    if (
      element.children.some((child) => typeof child !== "string" && !INLINE_TAGS.has(child.tag))
    ) {
      return true;
    }
    const reporting = this.reporting;
    this.reporting = false;
    const { style } = this.stylesOf(element);
    this.reporting = reporting;
    return withoutText(style) !== undefined;
  }

  /**
   * Block content: each element a view, and each run of inline content a text block. In a flex
   * container every child is its own item, as CSS blockifies them: a `<span>` pill there is a box.
   */
  blocks(
    content: Array<HtmlElement | string>,
    inherited: Inherited,
    flex = false,
  ): FarmNativeNode[] {
    if (flex) {
      const items: FarmNativeNode[] = [];
      for (const child of content) {
        const item =
          typeof child === "string"
            ? this.text({ tag: "#text", attributes: {}, children: [] }, [child], inherited)
            : this.element(child, inherited, true);
        if (item) items.push(item);
      }
      return items;
    }
    const nodes: FarmNativeNode[] = [];
    let pending: Array<HtmlElement | string> = [];
    const flush = () => {
      const block = this.text({ tag: "#text", attributes: {}, children: [] }, pending, inherited);
      if (block) nodes.push(block);
      pending = [];
    };
    for (const child of content) {
      if (typeof child === "string" || (INLINE_TAGS.has(child.tag) && !this.isBlockLink(child))) {
        pending.push(child);
        continue;
      }
      flush();
      const node = this.element(child, inherited);
      if (node) nodes.push(node);
    }
    flush();
    return nodes;
  }

  element(
    element: HtmlElement,
    inherited: Inherited,
    flexItem = false,
  ): FarmNativeNode | undefined {
    if (SKIPPED_TAGS.has(element.tag)) return undefined;
    const own = this.stylesOf(element);
    if (own.style.display === "none") return undefined;
    const passed: Inherited = {
      style: { ...inherited.style, ...textOnly(own.style) },
      dark: { ...inherited.dark, ...textOnly(own.dark) },
    };
    // Native views do not inherit color: a `border` takes the text color it would on the web.
    const current = (style: FarmNativeStyle | undefined, color: unknown) =>
      style &&
      Object.fromEntries(
        Object.entries(style).map(([key, value]) => [
          key,
          value === "currentColor" && typeof color === "string" ? color : value,
        ]),
      );
    const box = current(withoutText(own.style), passed.style.color);
    const boxDark = current(withoutText(own.dark), passed.dark.color ?? passed.style.color);

    const flex = own.style.display === "flex";
    // A flex item that is inline on the web is a text box of its own.
    const textBox =
      flexItem && INLINE_TAGS.has(element.tag) && element.tag !== "a" && element.tag !== "br";
    if (BLOCK_TEXT_TAGS.has(element.tag) || textBox) {
      if (
        element.children.some((child) => typeof child !== "string" && !INLINE_TAGS.has(child.tag))
      ) {
        this.problem(`<${element.tag}> holds block elements`);
      }
      const node = this.text(element, element.children, inherited, own);
      return node ?? this.node("View", element, box, boxDark);
    }
    if (element.tag === "img") {
      const node = this.node("Image", element, box, boxDark);
      node.src = this.url(element.attributes.src);
      if (element.attributes.alt) node.alt = element.attributes.alt;
      if (!node.src) this.problem("<img> without src");
      return node;
    }
    if (element.tag === "input" || element.tag === "textarea") {
      const node = this.node(
        "TextInput",
        element,
        settleLineHeight({ ...passed.style, ...box }),
        boxDark,
      );
      if (element.attributes.placeholder) node.placeholder = element.attributes.placeholder;
      const value = element.tag === "textarea" ? textContent(element) : element.attributes.value;
      if (value) node.value = value;
      return node;
    }
    if (element.tag === "a" || element.tag === "button") {
      const node = this.node("Pressable", element, box, boxDark);
      if (element.tag === "a") node.href = this.url(element.attributes.href);
      node.children = this.blocks(element.children, passed, flex);
      return node;
    }
    if (element.tag === "hr") {
      return this.node(
        "View",
        element,
        {
          borderTopWidth: 1,
          borderTopColor: String(passed.style.color ?? "currentColor"),
          ...box,
        },
        boxDark,
      );
    }
    if (VIEW_TAGS.has(element.tag)) {
      const node = this.node("View", element, box, boxDark);
      const children = this.blocks(element.children, passed, flex);
      if (children.length > 0) node.children = children;
      return node;
    }
    if (INLINE_TAGS.has(element.tag)) {
      // A link holding blocks, or inline content at the top: a text block.
      return this.text(element, [element], inherited);
    }
    this.problem(`<${element.tag}>`);
    return undefined;
  }
}

function textContent(element: HtmlElement): string {
  return element.children
    .map((child) => (typeof child === "string" ? child : textContent(child)))
    .join("");
}

/** Collapse HTML whitespace across runs, as a browser lays out inline text. */
function collapse(runs: Array<FarmNativeNode | string>): Array<FarmNativeNode | string> {
  let previousSpace = true;
  const walk = (items: Array<FarmNativeNode | string>): Array<FarmNativeNode | string> => {
    const out: Array<FarmNativeNode | string> = [];
    for (const item of items) {
      if (typeof item === "string") {
        if (item === "\n") {
          out.push(item);
          previousSpace = true;
          continue;
        }
        let text = item.replace(/[ \t\r\n\f]+/g, " ");
        if (previousSpace) text = text.replace(/^ /, "");
        if (text) {
          previousSpace = text.endsWith(" ");
          out.push(text);
        }
        continue;
      }
      const children = item.children ? walk(item.children) : [];
      if (children.length > 0 || item.href) out.push({ ...item, children });
    }
    return out;
  };
  const out = walk(runs);
  // Trailing whitespace of the block.
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const item = out[index]!;
    if (typeof item !== "string") break;
    const trimmed = item.replace(/ $/, "");
    if (trimmed) {
      out[index] = trimmed;
      break;
    }
    out.splice(index, 1);
  }
  return out;
}

const parsedSheets = new Map<string, FarmNativeStylesheet>();

/** Parse once per stylesheet text: a build's CSS is the same on every request. */
function parsedStylesheet(css: string): FarmNativeStylesheet {
  let sheet = parsedSheets.get(css);
  if (!sheet) {
    sheet = parseFarmNativeStylesheet(css);
    if (parsedSheets.size >= 16) parsedSheets.delete(parsedSheets.keys().next().value!);
    parsedSheets.set(css, sheet);
  }
  return sheet;
}

/**
 * A rendered page's tree: the page's own content (`#__farm_page__`, or `#root` without layouts),
 * since a native screen shows the page without its layouts.
 */
export function createFarmNativeTree(
  html: string,
  pageUrl: URL,
  /** The page's stylesheets' text; omitted, only Tailwind classes resolve. */
  stylesheets?: readonly string[],
): FarmNativeTree {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const document = parseHtml(_readFarmRenderedHtml(html));
  const page =
    find(document, (element) => element.attributes.id === "__farm_page__") ??
    find(document, (element) => element.attributes.id === "root") ??
    find(document, (element) => element.tag === "body") ??
    document;
  const converter = new Converter(pageUrl, stylesheets?.map(parsedStylesheet));
  // What the elements above the page pass down: text styles, and the background the screen shows.
  const ancestors: HtmlElement[] = [];
  for (let element = page.parent; element; element = element.parent) ancestors.unshift(element);
  const inherited = { style: {} as FarmNativeStyle, dark: {} as FarmNativeStyle };
  let background: FarmNativeStyle = {};
  converter.reporting = false;
  for (const element of [...ancestors, page]) {
    if (element.tag === "#root") continue;
    const own = converter.stylesOf(element);
    Object.assign(inherited.style, textOnly(own.style));
    Object.assign(inherited.dark, textOnly(own.dark));
    if (own.style.backgroundColor) background = { backgroundColor: own.style.backgroundColor };
    if (own.dark.backgroundColor)
      background = { ...background, darkBackground: own.dark.backgroundColor };
  }
  converter.reporting = true;
  const { darkBackground, ...light } = background;
  const root: FarmNativeNode = {
    type: "View",
    tag: page.tag,
    ...(Object.keys(light).length > 0 ? { style: light } : {}),
    ...(darkBackground ? { dark: { backgroundColor: darkBackground } } : {}),
  };
  const children = converter.blocks(page.children, inherited);
  if (children.length > 0) root.children = children;
  return {
    version: 1,
    ...(title ? { title: decode(title.trim()) } : {}),
    root,
    unsupported: converter.unsupported,
  };
}

/** The page's stylesheets in document order: same-origin `<link>` hrefs and `<style>` text. */
export function readFarmPageStylesheets(
  html: string,
  pageUrl: URL,
): Array<{ href?: string; inline?: string }> {
  const out: Array<{ href?: string; inline?: string }> = [];
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? html;
  for (const match of head.matchAll(/<link\b([^>]*)>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (match[2] !== undefined) {
      out.push({ inline: match[2] });
      continue;
    }
    const attributes = match[1]!;
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(attributes)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
    if (!href) continue;
    const resolved = new URL(decode(href), pageUrl);
    // A cross-origin stylesheet (a font service, say) is the browser's to fetch.
    if (resolved.origin === pageUrl.origin) out.push({ href: resolved.pathname + resolved.search });
  }
  return out;
}

/** The shell's request: a native tree, not HTML. */
export function farmRequestWantsNativeTree(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes(FARM_NATIVE_TREE_CONTENT_TYPE);
}

/**
 * Answer the shell's request for a page's tree. `renderPage` renders the page for a browser.
 * Responses that are not an HTML page (a redirect, a sign-in gate, an error) go back as they are,
 * so the shell can follow or show them as it would for the web screen.
 */
export async function createFarmNativeTreeResponse(options: {
  request: Request;
  renderPage: (request: Request) => Response | Promise<Response>;
  /**
   * A stylesheet's text by its href. Without it, `renderPage` serves it, as the dev server does;
   * a production server passes the client CSS its build embedded.
   */
  loadStylesheet?: (href: string) => string | undefined | Promise<string | undefined>;
}): Promise<Response> {
  const headers = new Headers(options.request.headers);
  headers.set("accept", "text/html");
  headers.delete("accept-encoding");
  const page = await options.renderPage(
    new Request(options.request.url, {
      method: "GET",
      headers,
      signal: options.request.signal,
    }),
  );
  const type = page.headers.get("content-type") ?? "";
  if (page.status !== 200 || !type.includes("text/html")) return page;
  const html = await page.text();
  const pageUrl = new URL(options.request.url);
  const load =
    options.loadStylesheet ??
    (async (href: string) => {
      const response = await options.renderPage(
        new Request(new URL(href, pageUrl), {
          headers: { accept: "text/css,*/*;q=0.1", cookie: headers.get("cookie") ?? "" },
          signal: options.request.signal,
        }),
      );
      return response.status === 200 && response.headers.get("content-type")?.includes("text/css")
        ? response.text()
        : undefined;
    });
  const stylesheets: string[] = [];
  for (const source of readFarmPageStylesheets(html, pageUrl)) {
    const css = source.inline ?? (await load(source.href!));
    if (css === undefined) {
      // The page is styled by CSS the tree cannot read: show the web screen.
      const tree: FarmNativeTree = {
        version: 1,
        root: { type: "View", tag: "#root" },
        unsupported: [`stylesheet "${source.href}" could not be read`],
      };
      return new Response(JSON.stringify(tree), {
        headers: {
          "Content-Type": `${FARM_NATIVE_TREE_CONTENT_TYPE}; charset=utf-8`,
          Vary: "Accept",
        },
      });
    }
    stylesheets.push(css);
  }
  const tree = createFarmNativeTree(html, pageUrl, stylesheets);
  const out = new Headers({
    "Content-Type": `${FARM_NATIVE_TREE_CONTENT_TYPE}; charset=utf-8`,
    Vary: "Accept",
    "Cache-Control": page.headers.get("cache-control") ?? "no-store",
  });
  for (const cookie of page.headers.getSetCookie?.() ?? []) out.append("Set-Cookie", cookie);
  return new Response(options.request.method === "HEAD" ? null : JSON.stringify(tree), {
    status: 200,
    headers: out,
  });
}
