import type { FarmImageConfig } from "./image-config";
import { formatOptionalPeerInstallHint, isOptionalPeerInstalled } from "./optional-peer";
import { logger } from "./utils";

export const SHARP_INSTALL_HINT = formatOptionalPeerInstallHint("sharp", "optimize images");

/** Cloudflare presets transform images on the platform and never load Sharp. */
const CLOUDFLARE_IMAGE_PRESETS = new Set(["cloudflare", "cloudflare-pages", "cloudflare-module"]);

/**
 * Sharp is an optional peer of @farm.js/core. Decide whether this run needs it
 * (development always optimizes with Sharp; production needs it on every
 * non-Cloudflare preset) and, when it is not installed:
 *
 * - `provider: "node"` fails with the install command;
 * - `provider: "auto"` (and `"cloudflare"` in development) falls back to the
 *   documented `provider: "none"` mode: original image URLs and no optimizer
 *   endpoint, so pages keep working without optimization.
 *
 * The returned images config is what the client, the dev handler, and the
 * production runtime must all use, so callers apply it before building plugins.
 */
export function resolveFarmImageProviderForRuntime<T extends FarmImageConfig>(
  images: T | undefined,
  options: { root: string; preset?: string; dev?: boolean },
): T | undefined {
  const provider = images?.provider ?? "auto";
  if (provider === "none") return images;
  const usesSharp = options.dev
    ? true
    : provider === "node" ||
      (provider === "auto" && !CLOUDFLARE_IMAGE_PRESETS.has(options.preset || ""));
  if (!usesSharp || isOptionalPeerInstalled(options.root, "sharp")) return images;

  if (provider === "node") {
    throw new Error(
      `images.provider "node" optimizes images with sharp, which is not installed. ${SHARP_INSTALL_HINT}`,
    );
  }
  logger.info(
    `Image optimization is off because sharp is not installed; images use their original URLs. ${SHARP_INSTALL_HINT}, or set images.provider to "none".`,
  );
  return Object.freeze({ ...images, provider: "none" }) as T;
}
