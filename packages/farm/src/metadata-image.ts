import type { ImageResponseOptions } from "@vercel/og";
import type { ReactElement } from "react";

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

export type FarmMetadataImageResponseOptions = {
  method?: string;
  ifNoneMatch?: string | null;
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

  if (type && typeof type === "object") {
    if (type.$$typeof === REACT_MEMO_TYPE) {
      const { createElement } = await import("react");
      return prepareMetadataImageNode(createElement(type.type, props));
    }
    if (type.$$typeof === REACT_FORWARD_REF_TYPE) {
      return prepareMetadataImageNode(await type.render(props, null));
    }
    if (type.$$typeof === REACT_LAZY_TYPE) {
      const { createElement } = await import("react");
      return prepareMetadataImageNode(createElement(type._init(type._payload), props));
    }
  }

  const preparedChildren = await prepareMetadataImageNode(props.children);
  const preparedProps: Record<string, unknown> = { ...props };

  if (typeof preparedProps.className === "string") {
    preparedProps.tw = [preparedProps.tw, preparedProps.className].filter(Boolean).join(" ");
    delete preparedProps.className;
  }
  delete preparedProps.children;

  const { createElement } = await import("react");
  return createElement(type, {
    ...preparedProps,
    key: element.key,
    children: preparedChildren,
  });
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

  const matchesEntityTag =
    options.ifNoneMatch?.trim() === "*" ||
    options.ifNoneMatch
      ?.split(",")
      .some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
  if (matchesEntityTag) {
    return new Response(null, { status: 304, headers: responseHeaders });
  }

  return new Response(options.method?.toUpperCase() === "HEAD" ? null : body, {
    status: 200,
    headers: responseHeaders,
  });
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
    return method === "HEAD"
      ? new Response(null, { status: value.status, headers: value.headers })
      : value;
  }

  const cacheControl = resolveCacheControl(imageModule.revalidate);
  const explicitContentType = imageModule.contentType?.split(";", 1)[0]?.trim().toLowerCase();

  if (isReactElement(value) && explicitContentType !== "image/svg+xml") {
    const { ImageResponse } = await import("@vercel/og");
    const element = (await prepareMetadataImageNode(value)) as ReactElement;
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
  } else if (isReactElement(value)) {
    const { renderToStaticMarkup } = await import("react-dom/server");
    body = toArrayBuffer(new TextEncoder().encode(renderToStaticMarkup(value)));
  } else {
    throw new Error("Metadata image must return a Response, string, bytes, or React element");
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
