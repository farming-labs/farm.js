import type { ResolvedFarmImageConfig } from "./image-config";
import {
  FarmImageRequestError,
  selectOutputFormat,
  type FarmImageTransformer,
} from "./image-server";
import { isConnectLookupSupported } from "./connect-lookup-support";
import { createSafeFetch, isPrivateAddress, SafeFetchError } from "./safe-fetch";

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
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new FarmImageRequestError("PRIVATE_SOURCE", 400, "Private image source is not allowed");
    }
  };
}

/**
 * Create a remote image fetcher whose socket lookup rejects private addresses.
 * Validation and connection share this lookup, closing the DNS-rebinding gap
 * left by resolving a hostname before a separate global fetch. Built on
 * `createSafeFetch`, with its refusals reported as image request errors.
 */
export function createNodeImageFetcher(
  config: Pick<ResolvedFarmImageConfig, "dangerouslyAllowLocalIP">,
  lookup?: NodeImageDnsLookup,
): typeof globalThis.fetch {
  if (config.dangerouslyAllowLocalIP) return globalThis.fetch.bind(globalThis);
  // Bun's `node:http` never calls `lookup`, so the check can't run at connect time there. The
  // image handler still checks every hop's addresses first (`createNodeImageUrlValidator`),
  // which is all that ran on Bun before.
  if (!isConnectLookupSupported()) return globalThis.fetch.bind(globalThis);

  const fetchSafely = createSafeFetch({
    lookup: lookup
      ? (hostname) =>
          new Promise((resolve, reject) => {
            lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
              if (error) reject(error);
              else resolve(addresses);
            });
          })
      : undefined,
  });

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await fetchSafely(input, init);
    } catch (error) {
      throw toImageRequestError(error);
    }
  }) as typeof globalThis.fetch;
}

function toImageRequestError(error: unknown): unknown {
  if (!(error instanceof SafeFetchError)) return error;
  switch (error.code) {
    case "ADDRESS_BLOCKED":
      return new FarmImageRequestError(
        "PRIVATE_SOURCE",
        400,
        "Private image source is not allowed",
      );
    case "INVALID_URL":
    case "PROTOCOL_NOT_ALLOWED":
    case "CREDENTIALS_IN_URL":
    case "PORT_NOT_ALLOWED":
      return new FarmImageRequestError("DISALLOWED_SOURCE", 400, "Unsupported image protocol");
    case "INVALID_RESPONSE":
      return new FarmImageRequestError(
        "UNSUPPORTED_IMAGE",
        502,
        "Image source returned an invalid HTTP status",
      );
    default:
      // A DNS failure or a missing runtime module is an operational error, reported through
      // the handler's `onError` as it was before.
      return error;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The image request was aborted", "AbortError");
  }
}
