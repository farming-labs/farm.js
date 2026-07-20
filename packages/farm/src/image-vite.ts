import { readFile } from "node:fs/promises";
import path from "node:path";
import { imageSize } from "image-size";
import type { Plugin } from "vite";

const FARM_IMAGE_ID_PREFIX = "\0farm:image:";
const STATIC_IMAGE_RE = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const SCRIPT_IMPORTER_RE = /\.(?:[cm]?[jt]sx?|mdx?)$/i;

export function farmImageImportsPlugin(): Plugin {
  return {
    name: "farm-image-imports",
    enforce: "pre",

    async resolveId(source, importer, options) {
      if (
        !importer ||
        source.includes("?") ||
        !STATIC_IMAGE_RE.test(source) ||
        !SCRIPT_IMPORTER_RE.test(importer.split("?", 1)[0])
      ) {
        return null;
      }

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return null;

      return `${FARM_IMAGE_ID_PREFIX}${encodeURIComponent(resolved.id.split("?", 1)[0])}`;
    },

    async load(id) {
      if (!id.startsWith(FARM_IMAGE_ID_PREFIX)) return null;

      const filePath = decodeURIComponent(id.slice(FARM_IMAGE_ID_PREFIX.length));
      const bytes = await readFile(filePath);
      const dimensions = imageSize(bytes);
      if (!dimensions.width || !dimensions.height) {
        throw new Error(`Could not determine image dimensions for ${filePath}`);
      }

      const blurDataURL = await createBlurDataURL(bytes);
      const assetRequest = `${filePath.replace(/\\/g, "/")}?url`;
      return [
        `import src from ${JSON.stringify(assetRequest)};`,
        `const image = ${JSON.stringify({
          width: dimensions.width,
          height: dimensions.height,
          ...(blurDataURL ? { blurDataURL } : {}),
        })};`,
        "image.src = src;",
        "export const src = image.src;",
        "export const width = image.width;",
        "export const height = image.height;",
        "export const blurDataURL = image.blurDataURL;",
        "export default image;",
      ].join("\n");
    },
  };
}

async function createBlurDataURL(bytes: Buffer): Promise<string | undefined> {
  try {
    const { default: sharp } = await import("sharp");
    const placeholder = await sharp(bytes)
      .rotate()
      .resize({ width: 8, height: 8, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 35 })
      .toBuffer();
    return `data:image/webp;base64,${placeholder.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export function isFarmStaticImageFile(filePath: string): boolean {
  return STATIC_IMAGE_RE.test(path.extname(filePath));
}
