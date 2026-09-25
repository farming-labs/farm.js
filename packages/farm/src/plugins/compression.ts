import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { FarmRequest, FarmResponse } from "../types";
import { pipeline, Readable } from "node:stream";
import { constants, createBrotliCompress, createGzip } from "node:zlib";

type SupportedEncoding = "br" | "gzip";

const Q_VALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

function parseEncodingQuality(header: string): Map<string, number> {
  const qualities = new Map<string, number>();

  for (const item of header.split(",")) {
    const [rawEncoding, ...parameters] = item.trim().split(";");
    const encoding = rawEncoding?.trim().toLowerCase();
    if (!encoding) continue;

    let quality = 1;
    for (const parameter of parameters) {
      const [rawName, rawValue] = parameter.split("=", 2);
      if (rawName?.trim().toLowerCase() !== "q") continue;
      const value = rawValue?.trim() ?? "";
      quality = Q_VALUE.test(value) ? Number(value) : 0;
    }

    qualities.set(encoding, Math.max(qualities.get(encoding) ?? 0, quality));
  }

  return qualities;
}

function selectEncoding(header: string): SupportedEncoding | undefined {
  if (!header.trim()) return undefined;

  const qualities = parseEncodingQuality(header);
  const wildcard = qualities.get("*") ?? 0;
  const quality = (encoding: SupportedEncoding) => qualities.get(encoding) ?? wildcard;
  const brotli = quality("br");
  const gzip = quality("gzip");

  if (brotli <= 0 && gzip <= 0) return undefined;
  return brotli >= gzip ? "br" : "gzip";
}

// Media types worth a compressor pass, listed the way nginx and CDN configs do
// it: an allowlist. A denylist fails open, so a png, mp4, zip, xlsx or woff2
// response was piped through brotli for a byte count it cannot improve, and any
// newly minted binary type would keep doing that until someone remembered to
// deny it. Everything here is either plain text or a container of uncompressed
// bytes.
const COMPRESSIBLE_MEDIA_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/ndjson",
  "application/wasm",
  "application/x-ndjson",
  "application/xml",
  // Font formats that store raw glyph tables. `font/woff` and `font/woff2` are
  // deliberately absent: their payloads are already deflate and brotli streams.
  "application/vnd.ms-fontobject",
  "font/otf",
  "font/ttf",
]);

// Structured syntax suffixes (RFC 6839), so `image/svg+xml`,
// `application/atom+xml`, `application/manifest+json`,
// `application/problem+json` and friends compress without being enumerated.
const COMPRESSIBLE_MEDIA_TYPE_SUFFIXES = ["+json", "+xml"];

function isCompressibleMediaType(mediaType: string | undefined): boolean {
  // A missing or empty content-type says nothing about the bytes, and an
  // undeclared body is as likely to be an opaque download as it is to be text,
  // so it stays untouched: guessing wrong spends a whole compressor pass on
  // bytes that are already compressed. A route that wants its body compressed
  // only has to declare what it returns.
  if (!mediaType) return false;

  // Kept as an explicit skip even though the allowlist already excludes it: an
  // event stream is a long-lived pipe whose delivery unit is the event, not the
  // chunk, so putting a compressor in front of it makes timely delivery depend
  // on flush behavior for no size win. Leaving it out of the pipeline entirely
  // is the honest contract, and naming it here keeps that reasoning attached to
  // the decision if the allowlist ever grows a `text/*` exception.
  if (mediaType === "text/event-stream") return false;

  // text/html, text/css, text/plain, text/javascript, text/x-component, and the
  // rest of text/* are all worth compressing.
  if (mediaType.startsWith("text/")) return true;
  if (COMPRESSIBLE_MEDIA_TYPES.has(mediaType)) return true;
  return COMPRESSIBLE_MEDIA_TYPE_SUFFIXES.some((suffix) => mediaType.endsWith(suffix));
}

function isCompressionEligible(request: Request, response: Response): boolean {
  if (
    (request.method !== "HEAD" && !response.body) ||
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304 ||
    response.headers.has("content-encoding") ||
    response.headers.has("content-range") ||
    response.headers.get("cache-control")?.toLowerCase().includes("no-transform")
  ) {
    return false;
  }

  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return isCompressibleMediaType(mediaType);
}

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("vary");
  const values = current
    ? current
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  if (values.includes("*")) return;
  if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) {
    values.push(value);
  }
  headers.set("vary", values.join(", "));
}

function compressResponse(response: Response, encoding: SupportedEncoding): Response {
  // Both compressors must flush per chunk. Without an explicit flush mode brotli
  // buffers until its 4 MB window fills or the source ends, so a streaming SSR,
  // RSC, or NDJSON response delivers nothing to the client until it completes -
  // and `selectEncoding` prefers brotli on every tie, so that is the default
  // path for an ordinary browser.
  const compressor =
    encoding === "br"
      ? createBrotliCompress({ flush: constants.BROTLI_OPERATION_FLUSH })
      : createGzip({ flush: constants.Z_SYNC_FLUSH });
  const input = Readable.fromWeb(response.body as any);
  const output = pipeline(input, compressor, () => {
    // pipeline forwards source failures to the compressed body and destroys
    // the source when the response consumer cancels it. The web stream owns
    // observing the resulting destination error.
  });
  const headers = new Headers(response.headers);

  headers.set("content-encoding", encoding);
  headers.delete("content-length");
  appendVary(headers, "Accept-Encoding");

  const etag = headers.get("etag");
  if (etag && !etag.startsWith("W/")) {
    headers.set("etag", `W/${etag}`);
  }

  return new Response(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function varyIdentityResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  appendVary(headers, "Accept-Encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createCompressionPlugin({
  beforeRequest: overrideBeforeRequest,
  afterResponse: overrideAfterResponse,
}: {
  beforeRequest?: (
    req: FarmRequest,
    res: FarmResponse,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  afterResponse?: (
    req: FarmRequest,
    res: FarmResponse,
    context: FarmPluginContext,
  ) => void | Promise<void>;
} = {}): FarmPlugin {
  return {
    name: "farm:compression",
    enforce: "post",

    runtime: {
      after({ request, response, isProd }) {
        if (!isProd || !isCompressionEligible(request, response)) return;

        if (request.method === "HEAD") return varyIdentityResponse(response);

        const encoding = selectEncoding(request.headers.get("accept-encoding") ?? "");
        if (!encoding) return varyIdentityResponse(response);
        return compressResponse(response, encoding);
      },
    },

    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
    },

    async afterResponse(req, res, context) {
      if (overrideAfterResponse) {
        await overrideAfterResponse(req, res, context);
      }
    },
  };
}
