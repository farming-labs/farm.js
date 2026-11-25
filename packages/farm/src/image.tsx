import { forwardRef, type ImgHTMLAttributes, type SyntheticEvent } from "react";
import * as ReactDOM from "react-dom";
import {
  resolveImageAttributes,
  type FarmImageLoader,
  type FarmImageOptions,
  type StaticImageData,
} from "./image-attributes";

export type { FarmImageLoader, FarmImageLoaderProps, StaticImageData } from "./image-attributes";

export interface ImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "width" | "height" | "loading" | "placeholder"
> {
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
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
}

export interface ImagePropsResult {
  props: ImgHTMLAttributes<HTMLImageElement>;
}

export function getImageProps(input: ImageProps): ImagePropsResult {
  // React's style and event types are stricter than the renderer-neutral options, not different.
  const attributes = resolveImageAttributes(input as unknown as FarmImageOptions);
  return { props: attributes as ImgHTMLAttributes<HTMLImageElement> };
}

export const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(input, ref) {
  const { props } = getImageProps(input);

  if (input.preload && typeof (ReactDOM as any).preload === "function") {
    (ReactDOM as any).preload(props.src as string, {
      as: "image",
      imageSrcSet: props.srcSet,
      imageSizes: props.sizes,
      fetchPriority: "high",
    });
  }

  return <img {...props} ref={ref} />;
});

Image.displayName = "Image";

export default Image;

export type {
  FarmImageConfig,
  FarmImageFormat,
  FarmImageLocalPattern,
  FarmImageProvider,
  FarmImageRemotePattern,
  ResolvedFarmImageConfig,
} from "./image-config";
