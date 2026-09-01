import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { FarmRequest, FarmResponse } from "../types";
import { Readable } from "node:stream";
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

function canCompress(request: Request, response: Response): boolean {
  if (
    request.method === "HEAD" ||
    !response.body ||
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304 ||
    response.headers.has("content-encoding") ||
    response.headers.has("content-range") ||
    response.headers.get("cache-control")?.toLowerCase().includes("no-transform")
  ) {
    return false;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType !== "text/event-stream";
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
  const compressor =
    encoding === "br" ? createBrotliCompress() : createGzip({ flush: constants.Z_SYNC_FLUSH });
  const input = Readable.fromWeb(response.body as any);
  const output = input.pipe(compressor);
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
        if (!isProd || !canCompress(request, response)) return;

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
