import type { ResolvedFarmImageConfig } from "./image-config";
import {
  FarmImageRequestError,
  isPrivateImageAddress,
  selectOutputFormat,
  type FarmImageTransformer,
} from "./image-server";

type NodeImageDnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: Array<{ address: string; family: number }>,
  ) => void,
) => void;

export function createSharpImageTransformer(): FarmImageTransformer {
  return async ({ source, sourceType, width, quality, accept, formats, signal }) => {
    // Sharp is an optional native runtime. Load it only when an image request
    // actually needs a transform so disabled/unused image pipelines do not add
    // a startup dependency or native-module initialization cost.
    const { default: sharp } = await import("sharp");
    throwIfAborted(signal);
    const outputFormat = selectOutputFormat(accept, formats);
    let pipeline = sharp(source, {
      animated: sourceType === "image/gif" || sourceType === "image/webp",
      failOn: "warning",
      limitInputPixels: 268_402_689,
    })
      .rotate()
      .resize({ width, fit: "inside", withoutEnlargement: true });

    // When the Accept header matches none of the configured formats, keep the
    // source's own format (svg rasterizes to png) instead of forcing JPEG —
    // that preserved neither transparency nor the truth of the content type.
    let encodedType: string;
    if (outputFormat === "image/avif") {
      pipeline = pipeline.avif({ quality });
      encodedType = "image/avif";
    } else if (outputFormat === "image/webp") {
      pipeline = pipeline.webp({ quality });
      encodedType = "image/webp";
    } else if (sourceType === "image/png" || sourceType === "image/svg+xml") {
      pipeline = pipeline.png();
      encodedType = "image/png";
    } else if (sourceType === "image/gif") {
      pipeline = pipeline.gif();
      encodedType = "image/gif";
    } else if (sourceType === "image/webp") {
      pipeline = pipeline.webp({ quality });
      encodedType = "image/webp";
    } else if (sourceType === "image/avif") {
      pipeline = pipeline.avif({ quality });
      encodedType = "image/avif";
    } else {
      pipeline = pipeline.jpeg({ quality });
      encodedType = "image/jpeg";
    }

    const body = await pipeline.toBuffer();
    throwIfAborted(signal);
    return {
      body,
      contentType: encodedType,
    };
  };
}

export function createNodeImageUrlValidator(config: ResolvedFarmImageConfig) {
  return async function validateNodeImageUrl(url: URL): Promise<void> {
    if (config.dangerouslyAllowLocalIP) return;

    let addresses: Array<{ address: string; family: number }>;
    try {
      // DNS is only needed by remote image requests. Keeping it out of the
      // initial server module graph reduces normal page/API startup work.
      const { lookup } = await import("node:dns/promises");
      addresses = await lookup(url.hostname, { all: true, verbatim: true });
    } catch {
      throw new FarmImageRequestError(
        "PRIVATE_SOURCE",
        400,
        "Could not safely resolve the image source",
      );
    }
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateImageAddress(address))) {
      throw new FarmImageRequestError("PRIVATE_SOURCE", 400, "Private image source is not allowed");
    }
  };
}

/**
 * Create a remote image fetcher whose socket lookup rejects private addresses.
 * Validation and connection share this lookup, closing the DNS-rebinding gap
 * left by resolving a hostname before a separate global fetch.
 */
export function createNodeImageFetcher(
  config: ResolvedFarmImageConfig,
  lookup?: NodeImageDnsLookup,
): typeof globalThis.fetch {
  if (config.dangerouslyAllowLocalIP) return globalThis.fetch.bind(globalThis);

  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const inputRequest = input instanceof Request ? input : undefined;
    const url = input instanceof URL ? input : new URL(inputRequest?.url ?? String(input));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new FarmImageRequestError("DISALLOWED_SOURCE", 400, "Unsupported image protocol");
    }

    const [{ request }, { Readable }, dns] = await Promise.all([
      url.protocol === "https:" ? import("node:https") : import("node:http"),
      import("node:stream"),
      lookup ? Promise.resolve(null) : import("node:dns"),
    ]);
    const resolveHostname = lookup ?? (dns!.lookup as unknown as NodeImageDnsLookup);
    const headers = new Headers(inputRequest?.headers);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");

    return new Promise<Response>((resolve, reject) => {
      const nodeRequest = request(
        url,
        {
          method: init.method ?? inputRequest?.method ?? "GET",
          headers: Object.fromEntries(headers.entries()),
          signal: init.signal ?? inputRequest?.signal,
          lookup(hostname, options, callback) {
            resolveHostname(hostname, { all: true, verbatim: true }, (error, addresses) => {
              if (error) {
                callback(error, "", 4);
                return;
              }
              if (
                addresses.length === 0 ||
                addresses.some(({ address }) => isPrivateImageAddress(address))
              ) {
                callback(
                  new FarmImageRequestError(
                    "PRIVATE_SOURCE",
                    400,
                    "Private image source is not allowed",
                  ),
                  "",
                  4,
                );
                return;
              }

              if (options.all) {
                (
                  callback as unknown as (
                    error: null,
                    addresses: Array<{ address: string; family: number }>,
                  ) => void
                )(null, addresses);
                return;
              }
              const address = addresses[0]!;
              callback(null, address.address, address.family);
            });
          },
        },
        (nodeResponse) => {
          const status = nodeResponse.statusCode ?? 500;
          if (status < 200 || status > 599) {
            nodeResponse.resume();
            reject(
              new FarmImageRequestError(
                "UNSUPPORTED_IMAGE",
                502,
                "Image source returned an invalid HTTP status",
              ),
            );
            return;
          }
          const responseHeaders = new Headers();
          for (let index = 0; index < nodeResponse.rawHeaders.length; index += 2) {
            responseHeaders.append(
              nodeResponse.rawHeaders[index]!,
              nodeResponse.rawHeaders[index + 1]!,
            );
          }
          const body =
            status === 204 || status === 205 || status === 304
              ? null
              : (Readable.toWeb(nodeResponse) as ReadableStream);
          resolve(
            new Response(body, {
              status,
              statusText: nodeResponse.statusMessage,
              headers: responseHeaders,
            }),
          );
        },
      );
      nodeRequest.once("error", reject);
      nodeRequest.end();
    });
  }) as typeof globalThis.fetch;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The image request was aborted", "AbortError");
  }
}
