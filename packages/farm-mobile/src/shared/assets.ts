import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MobileBundledAssets, MobileGeneratedFile } from "@farm.js/core/mobile";

/** Content types for the files a Farm client build emits. Anything else is binary. */
const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function bundledAssetContentType(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** A URL path from the build's manifest as a relative file path; null for anything unsafe. */
function relativeAssetPath(urlPath: string): string | null {
  if (!urlPath.startsWith("/") || urlPath.includes("\\")) return null;
  const segments = urlPath.slice(1).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

/**
 * The mobile client's files under `root` in the native project, plus the manifest the shell reads
 * (`{ version, entry, files: { "/path": "content/type" } }`). Empty without bundled assets.
 */
export async function createBundledAssetFiles(
  assets: MobileBundledAssets | undefined,
  options: { root: string; manifest: string },
): Promise<MobileGeneratedFile[]> {
  if (!assets) return [];
  const files: MobileGeneratedFile[] = [];
  const types: Record<string, string> = {};
  for (const urlPath of assets.files) {
    const relative = relativeAssetPath(urlPath);
    if (!relative)
      throw new Error(`Refusing to bundle the client file ${JSON.stringify(urlPath)}.`);
    files.push({
      path: `${options.root}/${relative}`,
      contents: new Uint8Array(await readFile(path.join(assets.dir, ...relative.split("/")))),
    });
    types[urlPath] = bundledAssetContentType(relative);
  }
  files.push({
    path: options.manifest,
    contents: `${JSON.stringify({ version: 1, entry: assets.entry, files: types }, null, 2)}\n`,
  });
  return files;
}
