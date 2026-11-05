import type { CSSProperties } from "react";

import { radius, type RadiusToken } from "./tokens";

export interface ImageProps {
  src: string;
  /** Alt text. Defaults to `""` (decorative), matching an explicit empty alt. */
  alt?: string;
  width?: number | string;
  height?: number | string;
  radius?: RadiusToken;
  fit?: CSSProperties["objectFit"];
  className?: string;
  style?: CSSProperties;
}

function length(value: number | string | undefined): string | undefined {
  if (value == null) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/** An image. Renders an `img` with a cover fit by default. */
export function Image({
  src,
  alt = "",
  width,
  height,
  radius: r,
  fit = "cover",
  className,
  style,
}: ImageProps) {
  const s: CSSProperties = { objectFit: fit, ...style };
  const w = length(width);
  if (w != null) s.width = w;
  const h = length(height);
  if (h != null) s.height = h;
  if (r != null) s.borderRadius = radius(r);
  return <img src={src} alt={alt} className={className} style={s} />;
}
