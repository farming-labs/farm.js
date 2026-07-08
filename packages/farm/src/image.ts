import { createElement, forwardRef } from "react";
import type { CSSProperties, ImgHTMLAttributes, Ref } from "react";

export interface StaticImageData {
  src: string;
  width?: number;
  height?: number;
  blurDataURL?: string;
}

export interface ImageLoaderProps {
  src: string;
  width: number;
  quality?: number;
}

export type ImageLoader = (props: ImageLoaderProps) => string;
export type ImageSource = string | StaticImageData;

export interface ImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "height" | "loading" | "src" | "srcSet" | "width"> {
  src: ImageSource;
  alt: string;
  width?: number | `${number}`;
  height?: number | `${number}`;
  fill?: boolean;
  quality?: number | `${number}`;
  priority?: boolean;
  loading?: "eager" | "lazy";
  placeholder?: "empty" | "blur";
  blurDataURL?: string;
  loader?: ImageLoader;
  unoptimized?: boolean;
  objectFit?: CSSProperties["objectFit"];
  objectPosition?: CSSProperties["objectPosition"];
}

type ImgProps = ImgHTMLAttributes<HTMLImageElement> & {
  fetchPriority?: "high" | "low" | "auto";
  ref?: Ref<HTMLImageElement>;
};

export const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  {
    src,
    alt,
    width,
    height,
    fill = false,
    quality,
    priority = false,
    loading,
    placeholder = "empty",
    blurDataURL,
    loader,
    unoptimized: _unoptimized,
    objectFit,
    objectPosition,
    style,
    ...rest
  },
  ref,
) {
  const source = resolveImageSource(src);
  const numericWidth = toNumber(width ?? source.width);
  const numericHeight = toNumber(height ?? source.height);
  const numericQuality = toNumber(quality);
  const resolvedSrc = loader
    ? loader({
        src: source.src,
        width: numericWidth ?? 0,
        quality: numericQuality,
      })
    : source.src;

  const placeholderImage = placeholder === "blur" ? blurDataURL || source.blurDataURL : undefined;
  const imageStyle: CSSProperties = {
    ...(placeholderImage
      ? {
          backgroundImage: `url(${placeholderImage})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }
      : null),
    ...(fill
      ? {
          height: "100%",
          inset: 0,
          objectFit,
          objectPosition,
          position: "absolute",
          width: "100%",
        }
      : null),
    ...style,
  };

  const imgProps: ImgProps = {
    ...rest,
    alt,
    decoding: rest.decoding || "async",
    height: fill ? undefined : numericHeight,
    loading: priority ? "eager" : loading || "lazy",
    ref,
    sizes: rest.sizes,
    src: resolvedSrc,
    style: Object.keys(imageStyle).length ? imageStyle : undefined,
    width: fill ? undefined : numericWidth,
  };

  if (priority) {
    imgProps.fetchPriority = "high";
  }

  return createElement("img", imgProps);
});

export default Image;

function resolveImageSource(src: ImageSource): StaticImageData {
  if (typeof src === "string") {
    return { src };
  }

  return src;
}

function toNumber(value: number | `${number}` | undefined) {
  if (value === undefined) return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}
