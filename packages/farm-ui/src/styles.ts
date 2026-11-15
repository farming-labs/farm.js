import type { CSSProperties } from "react";

import { color, radius, space, type ColorToken, type RadiusToken, type SpaceToken } from "./tokens";

/** Layout and surface props shared by box-like primitives (`View`, `Pressable`). */
export interface BoxStyleProps {
  padding?: SpaceToken;
  paddingX?: SpaceToken;
  paddingY?: SpaceToken;
  margin?: SpaceToken;
  marginX?: SpaceToken;
  marginY?: SpaceToken;
  gap?: SpaceToken;
  /** Flex main axis. `View` and `Pressable` default to `"column"`, as on native. */
  direction?: "row" | "column";
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  flex?: number;
  grow?: boolean;
  wrap?: boolean;
  background?: ColorToken;
  radius?: RadiusToken;
  borderColor?: ColorToken;
  borderWidth?: number;
  width?: number | string;
  height?: number | string;
  /** Escape hatch: raw CSS merged last, so it wins over the token props above. */
  style?: CSSProperties;
}

function length(value: number | string | undefined): string | undefined {
  if (value == null) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/** Turn box-style token props into a CSS style object. */
export function boxStyle(p: BoxStyleProps): CSSProperties {
  const s: CSSProperties = {};
  if (p.padding != null) s.padding = space(p.padding);
  if (p.paddingX != null) {
    s.paddingLeft = space(p.paddingX);
    s.paddingRight = space(p.paddingX);
  }
  if (p.paddingY != null) {
    s.paddingTop = space(p.paddingY);
    s.paddingBottom = space(p.paddingY);
  }
  if (p.margin != null) s.margin = space(p.margin);
  if (p.marginX != null) {
    s.marginLeft = space(p.marginX);
    s.marginRight = space(p.marginX);
  }
  if (p.marginY != null) {
    s.marginTop = space(p.marginY);
    s.marginBottom = space(p.marginY);
  }
  if (p.gap != null) s.gap = space(p.gap);
  if (p.direction != null) s.flexDirection = p.direction;
  if (p.align != null) s.alignItems = p.align;
  if (p.justify != null) s.justifyContent = p.justify;
  if (p.flex != null) s.flex = p.flex;
  if (p.grow) s.flexGrow = 1;
  if (p.wrap) s.flexWrap = "wrap";
  if (p.background != null) s.background = color(p.background);
  if (p.radius != null) s.borderRadius = radius(p.radius);
  if (p.borderColor != null || p.borderWidth != null) {
    s.borderStyle = "solid";
    s.borderWidth = p.borderWidth != null ? `${p.borderWidth}px` : "1px";
    s.borderColor = color(p.borderColor ?? "border");
  }
  const width = length(p.width);
  if (width != null) s.width = width;
  const height = length(p.height);
  if (height != null) s.height = height;
  return { ...s, ...p.style };
}
