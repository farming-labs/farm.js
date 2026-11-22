import type { ImageResponseOptions } from "@vercel/og";
import type { ReactElement } from "react";
import {
  isMissingPackageError,
  VERCEL_OG_INSTALL_HINT,
  withOptionalPeerCause,
} from "./optional-peer";
import type { FarmServerRendererRuntime } from "./renderer";
import { omitFarmResponseBody } from "./response-body";
import { matchesFarmIfNoneMatch } from "./server-http";

const REACT_ELEMENT_TYPE = Symbol.for("react.element");
const REACT_TRANSITIONAL_ELEMENT_TYPE = Symbol.for("react.transitional.element");
const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
const REACT_MEMO_TYPE = Symbol.for("react.memo");
const REACT_LAZY_TYPE = Symbol.for("react.lazy");

type MetadataImageSize = {
  width?: number;
  height?: number;
};

type MetadataImageFont = Omit<NonNullable<ImageResponseOptions["fonts"]>[number], "data"> & {
  data: ArrayBuffer | ArrayBufferView | Promise<ArrayBuffer | ArrayBufferView>;
};

export type FarmMetadataImageModule = {
  size?: MetadataImageSize;
  contentType?: string;
  revalidate?: number | false;
  fonts?: MetadataImageFont[];
  emoji?: ImageResponseOptions["emoji"];
  debug?: boolean;
};

/**
 * The app's server renderer, when it isn't React. Satori reads React-shaped elements, so an element
 * this renderer created renders to HTML with it, as a page would, and Farm reads the image tree back
 * from that markup. A React element still goes to Satori directly.
 */
export type FarmMetadataImageRenderer = Pick<
  FarmServerRendererRuntime,
  "createElement" | "isValidElement" | "renderToString"
>;

export type FarmMetadataImageResponseOptions = {
  method?: string;
  ifNoneMatch?: string | null;
  renderer?: FarmMetadataImageRenderer;
};

function isResponse(value: unknown): value is Response {
  return (
    typeof Response !== "undefined" &&
    (value instanceof Response ||
      Boolean(
        value &&
        typeof value === "object" &&
        typeof (value as Response).arrayBuffer === "function" &&
        (value as Response).headers,
      ))
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function",
  );
}

function isReactElement(value: unknown): value is ReactElement<Record<string, unknown>> {
  if (!value || typeof value !== "object") return false;
  const marker = (value as { $$typeof?: symbol }).$$typeof;
  return marker === REACT_ELEMENT_TYPE || marker === REACT_TRANSITIONAL_ELEMENT_TYPE;
}

/**
 * A React element, or an element the app renderer created. A string or bytes is an image body even
 * when the renderer's `isValidElement` accepts it, as Vue's and Solid's accept any value.
 */
function isMetadataImageElement(
  value: unknown,
  renderer: FarmMetadataImageRenderer | undefined,
): boolean {
  if (!value || typeof value !== "object") return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return false;
  return isReactElement(value) || renderer?.isValidElement(value) === true;
}

/**
 * Whether the app renderer reads this element, rather than Satori. A React element goes to Satori
 * unless the renderer claims it: preact/compat marks Preact's own elements as React's, and Preact's
 * `isValidElement` tells them apart. Vue's and Solid's accept any object, so they can't claim one.
 */
function rendersWithAppRenderer(
  value: unknown,
  renderer: FarmMetadataImageRenderer | undefined,
): renderer is FarmMetadataImageRenderer {
  if (!renderer?.isValidElement(value)) return false;
  return !isReactElement(value) || !renderer.isValidElement({});
}

/** Resolves a React element's function components into the plain tree Satori reads. */
async function prepareMetadataImageNode(node: unknown): Promise<unknown> {
  if (isThenable(node)) {
    return prepareMetadataImageNode(await node);
  }

  if (Array.isArray(node)) {
    return Promise.all(node.map((child) => prepareMetadataImageNode(child)));
  }

  if (!isReactElement(node)) {
    return node;
  }

  const element = node;
  const type = element.type as any;
  const props = element.props || {};

  if (typeof type === "function") {
    if (type.prototype?.isReactComponent) {
      throw new Error(
        "Metadata image components must be stateless function components; React class components are not supported.",
      );
    }
    return prepareMetadataImageNode(await type(props));
  }

  const { createElement } = await import("react");
  if (type && typeof type === "object") {
    if (type.$$typeof === REACT_MEMO_TYPE) {
      return prepareMetadataImageNode(createElement(type.type, props));
    }
    if (type.$$typeof === REACT_FORWARD_REF_TYPE) {
      return prepareMetadataImageNode(await type.render(props, null));
    }
    if (type.$$typeof === REACT_LAZY_TYPE) {
      let resolvedType: unknown;
      try {
        resolvedType = type._init(type._payload);
      } catch (suspension) {
        if (suspension && typeof (suspension as Promise<unknown>).then === "function") {
          await suspension;
          resolvedType = type._init(type._payload);
        } else {
          throw suspension;
        }
      }
      return prepareMetadataImageNode(createElement(resolvedType as any, props));
    }
  }

  const preparedChildren = await prepareMetadataImageNode(props.children);
  const preparedProps: Record<string, unknown> = { ...props };

  if (typeof preparedProps.className === "string") {
    preparedProps.tw = [preparedProps.tw, preparedProps.className].filter(Boolean).join(" ");
    delete preparedProps.className;
  }
  delete preparedProps.children;

  return createElement(type, {
    ...preparedProps,
    key: element.key,
    children: preparedChildren,
  });
}

type MetadataImageNode = { type: string; props: Record<string, unknown> };
type MetadataImageMarkupElement = MetadataImageNode & { children: unknown[] };

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "template"]);
const MARKUP_ATTRIBUTE = /\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
const MARKUP_ENTITY = /&(#[0-9]+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};
const NUMERIC_VALUE = /^-?(?:\d+|\d*\.\d+)$/;

function decodeMarkupEntities(value: string): string {
  return value.replace(MARKUP_ENTITY, (entity, name: string) => {
    if (name[0] !== "#") return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    const code =
      name[1] === "x" || name[1] === "X"
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** Splits CSS declarations on `;`, except inside quotes or parentheses, as in `url(data:...;base64,...)`. */
function splitStyleDeclarations(css: string): string[] {
  const declarations: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      declarations.push(css.slice(start, index));
      start = index + 1;
    }
  }
  declarations.push(css.slice(start));
  return declarations;
}

/** Reads a `style` attribute back into the style object JSX would have passed. */
function parseInlineStyle(css: string): Record<string, string | number> {
  const style: Record<string, string | number> = {};
  for (const declaration of splitStyleDeclarations(css)) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim();
    const value = declaration
      .slice(colon + 1)
      .replace(/!important\s*$/i, "")
      .trim();
    if (!property || !value) continue;
    const name = property.startsWith("--")
      ? property
      : property
          .toLowerCase()
          .replace(/^-ms-/, "ms-")
          .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    style[name] = NUMERIC_VALUE.test(value) ? Number(value) : value;
  }
  return style;
}

function toMarkupProps(attributes: Record<string, string>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "style") props.style = parseInlineStyle(value);
    else if (name === "class") props.tw = [attributes.tw, value].filter(Boolean).join(" ");
    else if ((name === "width" || name === "height") && NUMERIC_VALUE.test(value)) {
      props[name] = Number(value);
    } else if (name !== "tw" || !("class" in attributes)) props[name] = value;
  }
  return props;
}

/**
 * Turns a renderer's server markup into the element tree Satori reads. Hydration comments are
 * dropped, so text they split joins up again, and whitespace between elements is dropped, as a
 * flex container ignores it.
 */
function readMetadataImageMarkup(markup: string): MetadataImageNode {
  const root: MetadataImageMarkupElement = { type: "", props: {}, children: [] };
  const open: MetadataImageMarkupElement[] = [root];
  const appendText = (text: string) => {
    if (!text) return;
    const { children } = open[open.length - 1]!;
    const last = children.length - 1;
    if (typeof children[last] === "string") children[last] += decodeMarkupEntities(text);
    else children.push(decodeMarkupEntities(text));
  };

  let index = 0;
  while (index < markup.length) {
    const tagStart = markup.indexOf("<", index);
    if (tagStart === -1) {
      appendText(markup.slice(index));
      break;
    }
    appendText(markup.slice(index, tagStart));

    if (markup.startsWith("<!--", tagStart)) {
      const end = markup.indexOf("-->", tagStart + 4);
      index = end === -1 ? markup.length : end + 3;
      continue;
    }
    if (markup[tagStart + 1] === "!" || markup[tagStart + 1] === "?") {
      const end = markup.indexOf(">", tagStart);
      index = end === -1 ? markup.length : end + 1;
      continue;
    }
    if (markup[tagStart + 1] === "/") {
      const end = markup.indexOf(">", tagStart);
      const name = markup
        .slice(tagStart + 2, end === -1 ? undefined : end)
        .trim()
        .toLowerCase();
      // A stray closing tag closes nothing; a skipped one closes the elements left open inside it.
      for (let depth = open.length - 1; depth > 0; depth--) {
        if (open[depth]!.type.toLowerCase() !== name) continue;
        open.length = depth;
        break;
      }
      index = end === -1 ? markup.length : end + 1;
      continue;
    }

    const name = /^[a-zA-Z][^\s/>]*/.exec(markup.slice(tagStart + 1))?.[0];
    if (!name) {
      appendText("<");
      index = tagStart + 1;
      continue;
    }
    const attributes: Record<string, string> = {};
    let cursor = tagStart + 1 + name.length;
    MARKUP_ATTRIBUTE.lastIndex = cursor;
    for (let match = MARKUP_ATTRIBUTE.exec(markup); match; match = MARKUP_ATTRIBUTE.exec(markup)) {
      attributes[match[1]!] = decodeMarkupEntities(match[2] ?? match[3] ?? match[4] ?? "");
      cursor = MARKUP_ATTRIBUTE.lastIndex;
    }
    const tagEnd = markup.indexOf(">", cursor);
    const selfClosing = markup.slice(cursor, tagEnd).trim() === "/";
    index = tagEnd === -1 ? markup.length : tagEnd + 1;

    const lowered = name.toLowerCase();
    if (RAW_TEXT_ELEMENTS.has(lowered)) {
      const close = markup.toLowerCase().indexOf(`</${lowered}`, index);
      const closeEnd = close === -1 ? -1 : markup.indexOf(">", close);
      index = closeEnd === -1 ? markup.length : closeEnd + 1;
      continue;
    }
    const element: MetadataImageMarkupElement = {
      type: name,
      props: toMarkupProps(attributes),
      children: [],
    };
    open[open.length - 1]!.children.push(element);
    if (!selfClosing && !VOID_ELEMENTS.has(lowered)) open.push(element);
  }

  const toNode = (element: MetadataImageMarkupElement): MetadataImageNode => {
    const hasElements = element.children.some((child) => typeof child !== "string");
    const children = element.children
      .filter((child) => !hasElements || typeof child !== "string" || child.trim() !== "")
      .map((child) =>
        typeof child === "string" ? child : toNode(child as MetadataImageMarkupElement),
      );
    const props = { ...element.props };
    if (children.length === 1) props.children = children[0];
    else if (children.length > 1) props.children = children;
    return { type: element.type, props };
  };

  const rootElements = root.children.filter(
    (child): child is MetadataImageMarkupElement => typeof child !== "string",
  );
  const rootText = root.children.some((child) => typeof child === "string" && child.trim() !== "");
  if (rootElements.length !== 1 || rootText) {
    throw new Error(
      `A metadata image must render one root element, but the app renderer rendered ${rootElements.length} elements${rootText ? " and text" : ""} at the top level. Wrap the image in a single element.`,
    );
  }
  return toNode(rootElements[0]!);
}

async function normalizeFonts(
  fonts: MetadataImageFont[] | undefined,
): Promise<ImageResponseOptions["fonts"] | undefined> {
  if (!fonts?.length) return undefined;

  return Promise.all(
    fonts.map(async (font) => {
      const data = await font.data;
      const arrayBuffer = ArrayBuffer.isView(data) ? toArrayBuffer(data) : data;
      return { ...font, data: arrayBuffer } as NonNullable<ImageResponseOptions["fonts"]>[number];
    }),
  );
}

function resolveCacheControl(revalidate: number | false | undefined): string {
  if (revalidate === false) {
    return "public, max-age=31536000, immutable";
  }
  if (typeof revalidate === "number" && Number.isFinite(revalidate) && revalidate > 0) {
    return `public, s-maxage=${Math.floor(revalidate)}, stale-while-revalidate=300`;
  }
  return "public, max-age=0, must-revalidate";
}

function toArrayBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return bytes.buffer;
}

async function createEntityTag(body: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", body);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return `"${hash}"`;
}

async function finalizeMetadataImageResponse(
  body: ArrayBuffer,
  headers: HeadersInit,
  options: FarmMetadataImageResponseOptions,
): Promise<Response> {
  const responseHeaders = new Headers(headers);
  const etag = await createEntityTag(body);
  responseHeaders.set("ETag", etag);
  responseHeaders.set("Content-Length", String(body.byteLength));
  responseHeaders.set("X-Content-Type-Options", "nosniff");

  if (matchesFarmIfNoneMatch(options.ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: responseHeaders });
  }

  return new Response(options.method?.toUpperCase() === "HEAD" ? null : body, {
    status: 200,
    headers: responseHeaders,
  });
}

async function loadVercelOg(): Promise<typeof import("@vercel/og")> {
  try {
    return await import("@vercel/og");
  } catch (error) {
    if (!isMissingPackageError(error, "@vercel/og")) throw error;
    throw withOptionalPeerCause(
      new Error(
        `Rendering a metadata image from JSX needs @vercel/og, which is not installed. ${VERCEL_OG_INSTALL_HINT}`,
      ),
      error,
    );
  }
}

/** @internal */
export async function createFarmMetadataImageResponse(
  value: unknown,
  imageModule: FarmMetadataImageModule,
  options: FarmMetadataImageResponseOptions = {},
): Promise<Response> {
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  if (isResponse(value)) {
    return method === "HEAD" ? omitFarmResponseBody(value) : value;
  }

  const cacheControl = resolveCacheControl(imageModule.revalidate);
  const explicitContentType = imageModule.contentType?.split(";", 1)[0]?.trim().toLowerCase();

  const { renderer } = options;
  const isElement = isMetadataImageElement(value, renderer);

  if (isElement && explicitContentType !== "image/svg+xml") {
    const { ImageResponse } = await loadVercelOg();
    const element = (
      rendersWithAppRenderer(value, renderer)
        ? readMetadataImageMarkup(await renderer.renderToString(value))
        : await prepareMetadataImageNode(value)
    ) as ReactElement;
    const response = new ImageResponse(element, {
      width: imageModule.size?.width || 1200,
      height: imageModule.size?.height || 630,
      fonts: await normalizeFonts(imageModule.fonts),
      emoji: imageModule.emoji,
      debug: imageModule.debug,
      headers: { "cache-control": cacheControl },
    });
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", cacheControl);
    return finalizeMetadataImageResponse(await response.arrayBuffer(), headers, options);
  }

  let body: ArrayBuffer;
  if (typeof value === "string") {
    body = toArrayBuffer(new TextEncoder().encode(value));
  } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    body = toArrayBuffer(value);
  } else if (isElement) {
    const markup = rendersWithAppRenderer(value, renderer)
      ? await renderer.renderToString(value)
      : (await import("react-dom/server")).renderToStaticMarkup(value as ReactElement);
    body = toArrayBuffer(new TextEncoder().encode(markup));
  } else {
    throw new Error(
      "Metadata image must return a Response, string, bytes, or an element: JSX, or one the app renderer created.",
    );
  }

  return finalizeMetadataImageResponse(
    body,
    {
      "Content-Type": imageModule.contentType || "image/svg+xml; charset=utf-8",
      "Cache-Control": cacheControl,
    },
    options,
  );
}

/**
 * The value a generated image module renders. Farm calls a default-exported function with the route
 * props, and it returns an element, a `Response`, a string, or bytes. A component in the renderer's
 * own file type (`opengraph-image.vue`, `opengraph-image.svelte`) is not a function Farm can
 * call, so it renders as that renderer's element.
 */
export async function resolveFarmMetadataImageValue(
  imageModule: { default?: unknown },
  props: unknown,
  options: { renderer?: FarmMetadataImageRenderer; component?: boolean } = {},
): Promise<unknown> {
  const image = imageModule.default;
  if (options.component && options.renderer) return options.renderer.createElement(image, props);
  return typeof image === "function" ? await image(props) : image;
}
