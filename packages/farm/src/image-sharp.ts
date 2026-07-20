import { lookup } from "node:dns/promises";
import sharp from "sharp";
import type { ResolvedFarmImageConfig } from "./image-config";
import {
  FarmImageRequestError,
  isPrivateImageAddress,
  selectOutputFormat,
  type FarmImageTransformer,
} from "./image-server";

export function createSharpImageTransformer(): FarmImageTransformer {
  return async ({ source, sourceType, width, quality, accept, formats, signal }) => {
    throwIfAborted(signal);
    const outputFormat = selectOutputFormat(accept, formats);
    let pipeline = sharp(source, {
      animated: sourceType === "image/gif" || sourceType === "image/webp",
      failOn: "warning",
      limitInputPixels: 268_402_689,
    })
      .rotate()
      .resize({ width, fit: "inside", withoutEnlargement: true });

    if (outputFormat === "image/avif") {
      pipeline = pipeline.avif({ quality });
    } else if (outputFormat === "image/webp") {
      pipeline = pipeline.webp({ quality });
    } else if (sourceType === "image/png") {
      pipeline = pipeline.png();
    } else if (sourceType === "image/gif") {
      pipeline = pipeline.gif();
    } else {
      pipeline = pipeline.jpeg({ quality });
    }

    const body = await pipeline.toBuffer();
    throwIfAborted(signal);
    return {
      body,
      contentType: outputFormat ?? normalizeSharpSourceType(sourceType),
    };
  };
}

export function createNodeImageUrlValidator(config: ResolvedFarmImageConfig) {
  return async function validateNodeImageUrl(url: URL): Promise<void> {
    if (config.dangerouslyAllowLocalIP) return;

    let addresses: Array<{ address: string; family: number }>;
    try {
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

function normalizeSharpSourceType(sourceType: string): string {
  return sourceType === "image/svg+xml" ? "image/png" : sourceType;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The image request was aborted", "AbortError");
  }
}
