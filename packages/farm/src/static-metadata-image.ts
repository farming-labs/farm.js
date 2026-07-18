import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { imageSize } from "image-size";

export const STATIC_METADATA_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"] as const;

export type StaticMetadataImageExtension = (typeof STATIC_METADATA_IMAGE_EXTENSIONS)[number];

export interface StaticMetadataImageInfo {
  extension: StaticMetadataImageExtension;
  contentType: string;
  width: number;
  height: number;
  alt?: string;
  hash: string;
  byteLength: number;
}

const CONTENT_TYPES: Record<StaticMetadataImageExtension, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function isStaticMetadataImageFile(filePath: string): boolean {
  return getStaticMetadataImageExtension(filePath) !== null;
}

export async function inspectStaticMetadataImage(
  filePath: string,
): Promise<StaticMetadataImageInfo> {
  const extension = getStaticMetadataImageExtension(filePath);
  if (!extension) {
    throw new Error(`Unsupported static metadata image: ${filePath}`);
  }

  const bytes = await readFile(filePath);
  let dimensions: ReturnType<typeof imageSize>;

  try {
    dimensions = imageSize(bytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read metadata image ${filePath}: ${reason}`);
  }

  if (!dimensions.width || !dimensions.height) {
    throw new Error(`Could not determine metadata image dimensions for ${filePath}`);
  }

  const alt = await readAltText(filePath);

  return {
    extension,
    contentType: CONTENT_TYPES[extension],
    width: dimensions.width,
    height: dimensions.height,
    alt,
    hash: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
    byteLength: bytes.byteLength,
  };
}

export function getStaticMetadataImageAltPath(filePath: string): string {
  return path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}.alt.txt`,
  );
}

function getStaticMetadataImageExtension(filePath: string): StaticMetadataImageExtension | null {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return STATIC_METADATA_IMAGE_EXTENSIONS.includes(extension as StaticMetadataImageExtension)
    ? (extension as StaticMetadataImageExtension)
    : null;
}

async function readAltText(filePath: string): Promise<string | undefined> {
  try {
    const value = (await readFile(getStaticMetadataImageAltPath(filePath), "utf8")).trim();
    return value || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
