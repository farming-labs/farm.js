import {
  DEFAULT_FARM_IMAGE_DEVICE_SIZES,
  DEFAULT_FARM_IMAGE_FORMATS,
  DEFAULT_FARM_IMAGE_PATH,
  DEFAULT_FARM_IMAGE_QUALITIES,
  DEFAULT_FARM_IMAGE_SIZES,
  type PublicFarmImageConfig,
} from "./image-config";

declare const __FARM_IMAGE_CONFIG__: PublicFarmImageConfig | undefined;

/** What a static image import (`import hero from "./hero.png"`) gives you. */
export interface StaticImageData {
  src: string;
  width: number;
  height: number;
  blurDataURL?: string;
}

export interface FarmImageLoaderProps {
  src: string;
  width: number;
  quality: number;
}

export type FarmImageLoader = (props: FarmImageLoaderProps) => string;

/** A style object with camelCased properties, as `createElement()` takes it. */
export type FarmImageStyle = Record<string, string | number | undefined>;

/** What `resolveImageAttributes()` takes: Farm's image options, plus any other `<img>` attribute. */
export interface FarmImageOptions {
  src: string | StaticImageData;
  alt: string;
  width?: number | `${number}`;
  height?: number | `${number}`;
  fill?: boolean;
  quality?: number;
  sizes?: string;
  loading?: "eager" | "lazy";
  preload?: boolean;
  placeholder?: "empty" | "blur";
  blurDataURL?: string;
  unoptimized?: boolean;
  loader?: FarmImageLoader;
  style?: FarmImageStyle;
  [attribute: string]: unknown;
}

/** The `<img>` attributes for an image, named as `createElement()` takes them. */
export interface FarmImageAttributes {
  alt: string;
  src: string;
  srcSet?: string;
  sizes?: string;
  width?: number;
  height?: number;
  loading: "eager" | "lazy";
  fetchPriority?: unknown;
  decoding: unknown;
  style: FarmImageStyle;
  [attribute: string]: unknown;
}

const FALLBACK_CONFIG: PublicFarmImageConfig = {
  provider: "auto",
  path: DEFAULT_FARM_IMAGE_PATH,
  deviceSizes: DEFAULT_FARM_IMAGE_DEVICE_SIZES,
  imageSizes: DEFAULT_FARM_IMAGE_SIZES,
  qualities: DEFAULT_FARM_IMAGE_QUALITIES,
  formats: DEFAULT_FARM_IMAGE_FORMATS,
};

function getImageConfig(): PublicFarmImageConfig {
  return typeof __FARM_IMAGE_CONFIG__ !== "undefined" && __FARM_IMAGE_CONFIG__
    ? __FARM_IMAGE_CONFIG__
    : FALLBACK_CONFIG;
}

function defaultImageLoader(config: PublicFarmImageConfig): FarmImageLoader {
  return ({ src, width, quality }) => {
    const query = new URLSearchParams({
      url: src,
      w: String(width),
      q: String(quality),
    });
    return `${config.path}?${query}`;
  };
}

function getClosestQuality(quality: number | undefined, allowed: readonly number[]): number {
  const requested = quality ?? 75;
  return allowed.reduce((closest, candidate) =>
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest,
  );
}

function getCandidateWidths(
  config: PublicFarmImageConfig,
  width: number | undefined,
  sizes: string | undefined,
  fill: boolean,
): { widths: number[]; descriptor: "w" | "x" } {
  const allSizes = [...new Set([...config.imageSizes, ...config.deviceSizes])].sort(
    (left, right) => left - right,
  );

  if (fill || sizes) {
    const viewportPercentages = [...(sizes?.matchAll(/(^|\s)(\d{1,3})vw/g) ?? [])].map((match) =>
      Number(match[2]),
    );
    if (viewportPercentages.length > 0) {
      const smallestRatio = Math.min(...viewportPercentages) / 100;
      const minimum = config.deviceSizes[0] * smallestRatio;
      return { widths: allSizes.filter((candidate) => candidate >= minimum), descriptor: "w" };
    }
    return { widths: allSizes, descriptor: "w" };
  }

  if (!width) return { widths: config.deviceSizes.slice(), descriptor: "w" };

  const requested = [width, width * 2];
  const widths = requested.map(
    (target) => allSizes.find((candidate) => candidate >= target) ?? allSizes.at(-1)!,
  );
  return { widths: [...new Set(widths)], descriptor: "x" };
}

function isStaticImageData(value: FarmImageOptions["src"]): value is StaticImageData {
  return typeof value === "object" && value !== null && typeof value.src === "string";
}

function shouldSkipOptimization(src: string, config: PublicFarmImageConfig): boolean {
  return (
    config.provider === "none" ||
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    /\.svg(?:$|[?#])/i.test(src)
  );
}

/**
 * The `<img>` attributes for an image served through Farm's image endpoint: `src` and `srcSet`
 * sized to `images.deviceSizes` and `images.imageSizes`, lazy loading, and the blur placeholder.
 * It loads no UI library, so any renderer can spread the result onto its own `<img>`.
 */
export function resolveImageAttributes(options: FarmImageOptions): FarmImageAttributes {
  const {
    src: srcInput,
    alt,
    width: widthInput,
    height: heightInput,
    fill = false,
    quality: qualityInput,
    sizes: sizesInput,
    loading,
    preload = false,
    placeholder = "empty",
    blurDataURL: blurDataURLInput,
    unoptimized: unoptimizedInput = false,
    loader: loaderInput,
    style,
    ...rest
  } = options;
  const config = getImageConfig();
  const staticImage = isStaticImageData(srcInput) ? srcInput : undefined;
  const src = typeof srcInput === "string" ? srcInput : srcInput.src;
  const width = Number(widthInput ?? staticImage?.width) || undefined;
  const height = Number(heightInput ?? staticImage?.height) || undefined;
  const blurDataURL = blurDataURLInput ?? staticImage?.blurDataURL;

  if (!fill && (!width || !height)) {
    throw new TypeError(
      "Farm Image requires width and height unless src is a static import or fill is enabled",
    );
  }
  if (fill && (widthInput !== undefined || heightInput !== undefined)) {
    throw new TypeError("Farm Image cannot use width or height together with fill");
  }
  if (placeholder === "blur" && !blurDataURL) {
    throw new TypeError("Farm Image placeholder=blur requires a static import or blurDataURL");
  }

  const unoptimized = unoptimizedInput || shouldSkipOptimization(src, config);
  const quality = getClosestQuality(qualityInput, config.qualities);
  const loader = loaderInput ?? defaultImageLoader(config);
  const sizes = sizesInput ?? (fill ? "100vw" : undefined);
  const candidates = getCandidateWidths(config, width, sizes, fill);
  const srcSet = unoptimized
    ? undefined
    : candidates.widths
        .map((candidate, index) => {
          const descriptor = candidates.descriptor === "w" ? `${candidate}w` : `${index + 1}x`;
          return `${loader({ src, width: candidate, quality })} ${descriptor}`;
        })
        .join(", ");
  const renderedSrc = unoptimized
    ? src
    : loader({ src, width: candidates.widths.at(-1) ?? width ?? config.deviceSizes[0], quality });
  const fillStyle: FarmImageStyle | undefined = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
    : undefined;
  const placeholderStyle: FarmImageStyle | undefined =
    placeholder === "blur"
      ? {
          backgroundImage: `url("${blurDataURL}")`,
          backgroundPosition: "50% 50%",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
        }
      : undefined;

  return {
    ...rest,
    alt,
    src: renderedSrc,
    srcSet,
    sizes,
    width: fill ? undefined : width,
    height: fill ? undefined : height,
    loading: preload ? "eager" : (loading ?? "lazy"),
    fetchPriority: preload ? "high" : rest.fetchPriority,
    decoding: rest.decoding ?? "async",
    style: { ...fillStyle, ...placeholderStyle, ...style },
  };
}
