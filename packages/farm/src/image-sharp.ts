import type { ResolvedFarmImageConfig } from "./image-config";
import {
  FarmImageRequestError,
  isPrivateImageAddress,
  selectOutputFormat,
  type FarmImageTransformer,
} from "./image-server";

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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The image request was aborted", "AbortError");
  }
}
