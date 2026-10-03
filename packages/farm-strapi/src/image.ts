export interface StrapiMediaFormat {
  url: string;
  width: number;
  height: number;
}

export interface StrapiMediaAsset extends StrapiMediaFormat {
  alternativeText?: string | null;
  formats?: Record<string, StrapiMediaFormat | null | undefined> | null;
}

export interface StrapiImageOptions {
  /** Public media origin used to resolve relative upload URLs. */
  mediaUrl?: string;
  /** Requested rendered width. Defaults to the original asset width. */
  width?: number;
  alt?: string;
  sizes?: string;
  loading?: "eager" | "lazy";
}

export interface StrapiImageProps {
  src: string;
  srcSet: string;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  loading: "eager" | "lazy";
  decoding: "async";
}

function resolveAssetUrl(url: string, mediaUrl: string | undefined): string {
  if (!mediaUrl && !/^https?:\/\//i.test(url)) {
    throw new TypeError("A Strapi media URL is required for relative asset URLs");
  }
  let resolved: URL;
  try {
    resolved = new URL(url, mediaUrl ? `${mediaUrl.replace(/\/$/, "")}/` : undefined);
  } catch {
    throw new TypeError("Strapi image asset URL must be a valid HTTP or HTTPS URL");
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new TypeError("Strapi image asset URL must use HTTP or HTTPS");
  }
  return resolved.toString();
}

function imageCandidates(asset: StrapiMediaAsset, mediaUrl: string | undefined) {
  const candidates = [asset, ...Object.values(asset.formats ?? {}).filter(Boolean)]
    .filter(
      (candidate): candidate is StrapiMediaFormat =>
        !!candidate &&
        Number.isFinite(candidate.width) &&
        candidate.width > 0 &&
        Number.isFinite(candidate.height) &&
        candidate.height > 0,
    )
    .map((candidate) => ({
      ...candidate,
      url: resolveAssetUrl(candidate.url, mediaUrl),
    }))
    .sort((left, right) => left.width - right.width);

  return [...new Map(candidates.map((candidate) => [candidate.width, candidate])).values()];
}

/**
 * Builds native image props from the fixed variants Strapi generated at
 * upload time. The selected `src` is the smallest available image at least as
 * wide as requested; `srcSet` advertises the variants at their real widths.
 */
export function getStrapiImageProps(
  asset: StrapiMediaAsset,
  options: StrapiImageOptions = {},
): StrapiImageProps {
  if (
    !Number.isFinite(asset.width) ||
    asset.width <= 0 ||
    !Number.isFinite(asset.height) ||
    asset.height <= 0
  ) {
    throw new TypeError("Strapi image asset dimensions must be positive finite numbers");
  }
  const candidates = imageCandidates(asset, options.mediaUrl);
  if (candidates.length === 0) {
    throw new TypeError("Strapi image asset has no usable image variants");
  }

  const requestedWidth = options.width ?? asset.width;
  if (!Number.isFinite(requestedWidth) || requestedWidth <= 0) {
    throw new TypeError("Strapi image width must be a positive finite number");
  }
  const selected =
    candidates.find((candidate) => candidate.width >= requestedWidth) ?? candidates.at(-1)!;
  const renderedWidth = Math.round(Math.min(requestedWidth, selected.width));
  const renderedHeight = Math.round((selected.height / selected.width) * renderedWidth);

  return {
    src: selected.url,
    srcSet: candidates.map((candidate) => `${candidate.url} ${candidate.width}w`).join(", "),
    alt: options.alt ?? asset.alternativeText ?? "",
    width: renderedWidth,
    height: renderedHeight,
    ...(options.sizes ? { sizes: options.sizes } : {}),
    loading: options.loading ?? "lazy",
    decoding: "async",
  };
}
