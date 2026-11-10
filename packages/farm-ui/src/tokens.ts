// Design tokens shared by every @farm.js/ui primitive.
//
// On the web the tokens resolve to CSS values: colors become CSS custom
// properties (so an app theme can override them, with a built-in fallback),
// and space and radius use a fixed scale. On a mobile native screen the same
// token names will map to native styles, so a screen written once reads the
// same on both. Any raw value (a number, a CSS color, a `var(...)`) passes
// through unchanged, so the tokens never get in your way.

/** A space step (`"md"`), a raw number of pixels (`12`), or any CSS length. */
export type SpaceToken = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | (string & {}) | number;

/** A radius step (`"card"`), a raw number of pixels, or any CSS length. */
export type RadiusToken = "none" | "sm" | "md" | "lg" | "card" | "full" | (string & {}) | number;

/** A color token (`"surface"`), or any raw CSS color or `var(...)`. */
export type ColorToken =
  | "background"
  | "surface"
  | "muted"
  | "border"
  | "text"
  | "accent"
  | "accentText"
  | (string & {});

const SPACE: Record<string, string> = {
  none: "0",
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  "2xl": "32px",
};

const RADIUS: Record<string, string> = {
  none: "0",
  sm: "4px",
  md: "8px",
  lg: "12px",
  card: "12px",
  full: "9999px",
};

const COLOR_FALLBACK: Record<string, string> = {
  background: "#ffffff",
  surface: "#f6f6f6",
  muted: "#6b7280",
  border: "#e5e7eb",
  text: "#111111",
  accent: "#2f6f4f",
  accentText: "#ffffff",
};

/** Resolve a space token to a CSS length. */
export function space(value: SpaceToken | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") return `${value}px`;
  return SPACE[value] ?? value;
}

/** Resolve a radius token to a CSS length. */
export function radius(value: RadiusToken | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") return `${value}px`;
  return RADIUS[value] ?? value;
}

/** Resolve a color token to a themeable CSS value; raw colors pass through. */
export function color(value: ColorToken | undefined): string | undefined {
  if (value == null) return undefined;
  const fallback = COLOR_FALLBACK[value];
  return fallback ? `var(--farm-color-${value}, ${fallback})` : value;
}
