import type { CSSProperties, ReactNode } from "react";

import { color, type ColorToken } from "./tokens";

export type TextSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | (string & {}) | number;
export type TextWeight = "regular" | "medium" | "semibold" | "bold" | (string & {}) | number;

export type TextElement = "span" | "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "label" | "div";

const SIZE: Record<string, string> = {
  xs: "12px",
  sm: "13px",
  md: "15px",
  lg: "18px",
  xl: "22px",
  "2xl": "28px",
  "3xl": "34px",
};

const WEIGHT: Record<string, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

export interface TextProps {
  children?: ReactNode;
  size?: TextSize;
  weight?: TextWeight;
  color?: ColorToken;
  align?: CSSProperties["textAlign"];
  /** Clamp to this many lines with an ellipsis. */
  numberOfLines?: number;
  className?: string;
  as?: TextElement;
  style?: CSSProperties;
}

function clamp(lines: number): CSSProperties {
  if (lines <= 1) {
    return { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  }
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  };
}

/** A run of text. Renders a `span` by default. */
export function Text({
  children,
  size,
  weight,
  color: textColor,
  align,
  numberOfLines,
  className,
  as: Tag = "span",
  style,
}: TextProps) {
  const s: CSSProperties = { ...style };
  if (size != null) s.fontSize = typeof size === "number" ? `${size}px` : (SIZE[size] ?? size);
  if (weight != null) {
    s.fontWeight = (
      typeof weight === "number" ? weight : (WEIGHT[weight] ?? weight)
    ) as CSSProperties["fontWeight"];
  }
  if (textColor != null) s.color = color(textColor);
  if (align != null) s.textAlign = align;
  if (numberOfLines != null) Object.assign(s, clamp(numberOfLines));
  return (
    <Tag className={className} style={s}>
      {children}
    </Tag>
  );
}
