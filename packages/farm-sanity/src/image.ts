import type { FarmImageLoader } from "@farm.js/core/image";
import { createImageUrlBuilder } from "@sanity/image-url";

export interface SanityImageLoaderOptions {
  projectId: string;
  dataset: string;
}

/**
 * A loader for `@farm.js/core/image` that resolves images on the Sanity CDN.
 *
 * `src` is either an asset id such as `image-abc-2000x3000-jpg` or a CDN URL
 * that already carries crop and hotspot parameters. Crop and hotspot live on
 * the image object and cannot pass through a string, so an app that needs them
 * builds the base URL with `@sanity/image-url` and hands that in as `src`.
 */
export function createSanityImageLoader(options: SanityImageLoaderOptions): FarmImageLoader {
  const builder = createImageUrlBuilder(options);

  return ({ src, width, quality }) => {
    const w = String(Math.round(width));
    const q = String(Math.round(quality));

    // A prebuilt CDN URL already carries crop and hotspot. The builder only
    // parses asset references, so append the responsive parameters directly.
    if (/^https?:\/\//.test(src)) {
      const url = new URL(src);
      url.searchParams.set("w", w);
      url.searchParams.set("q", q);
      url.searchParams.set("auto", "format");
      url.searchParams.set("fit", "max");
      return url.toString();
    }

    return (
      builder
        .image(src)
        .width(Math.round(width))
        .quality(Math.round(quality))
        // Let the CDN negotiate WebP or AVIF from the Accept header.
        .auto("format")
        // Serve the original when it is smaller than requested instead of upscaling.
        .fit("max")
        .url()
    );
  };
}
