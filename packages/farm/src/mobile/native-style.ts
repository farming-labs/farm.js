/**
 * Tailwind classes and inline styles as native style values, for the native tier: the server
 * renders a page, and the shell draws native views from it. Values come from Tailwind's default
 * theme (`native-theme.ts`); lengths are px, which the shell scales to dp or points.
 *
 * The analyzer checks a native-tier page with {@link farmNativeClassProblem}, so a class it lets
 * through always resolves here.
 */
import { FARM_NATIVE_THEME } from "./native-theme";

/** A style value: a length in px, a percentage such as `"50%"`, or a keyword. */
export type FarmNativeValue = number | string;

/** Style keys follow React Native's names, so one vocabulary serves every shell. */
export type FarmNativeStyle = Record<string, FarmNativeValue>;

/** Light styles, and the `dark:` overrides. */
export interface FarmNativeStyles {
  style: FarmNativeStyle;
  dark?: FarmNativeStyle;
}

/** Keys a native view inherits from its parent, as CSS text properties do. */
export const FARM_NATIVE_TEXT_KEYS = new Set([
  "color",
  "fontSize",
  "lineHeight",
  "fontWeight",
  "fontStyle",
  "fontFamily",
  "textAlign",
  "letterSpacing",
  "textTransform",
  "textDecorationLine",
  // `leading-*`: a multiple of the font size, or a fixed height. Either wins over the line
  // height a `text-*` size sets, as in Tailwind.
  "lineHeightScale",
  "lineHeightPx",
]);

const ALL_SIDES = ["Top", "Right", "Bottom", "Left"] as const;
const ALL_CORNERS = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"] as const;
const each = (keys: readonly string[], value: FarmNativeValue): FarmNativeStyle =>
  Object.fromEntries(keys.map((key) => [key, value]));

const SIDES = {
  t: ["Top"],
  r: ["Right"],
  b: ["Bottom"],
  l: ["Left"],
  x: ["Left", "Right"],
  y: ["Top", "Bottom"],
  s: ["Left"],
  e: ["Right"],
} as const;
const CORNERS: Record<string, string[]> = {
  t: ["TopLeft", "TopRight"],
  r: ["TopRight", "BottomRight"],
  b: ["BottomLeft", "BottomRight"],
  l: ["TopLeft", "BottomLeft"],
  tl: ["TopLeft"],
  tr: ["TopRight"],
  br: ["BottomRight"],
  bl: ["BottomLeft"],
};
const ALIGN: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
  stretch: "stretch",
  baseline: "baseline",
  auto: "auto",
};
const DROPPED = /^(?:relative|cursor-.+|select-.+|outline-.+|pointer-events-.+)$/;

/**
 * The values Tailwind classes resolve to: Tailwind's default theme, or an app's theme on top of it
 * (`createFarmNativeTheme`). Lengths are in px, tracking in em, text is [size, line height].
 * `darkColors` are colors whose value changes in dark mode.
 */
export interface FarmNativeTheme {
  spacing: number;
  colors: Readonly<Record<string, string>>;
  darkColors?: Readonly<Record<string, string>>;
  text: Readonly<Record<string, readonly [number, number]>>;
  fontWeight: Readonly<Record<string, number>>;
  tracking: Readonly<Record<string, number>>;
  leading: Readonly<Record<string, number>>;
  radius: Readonly<Record<string, number>>;
  container: Readonly<Record<string, number>>;
}

const DEFAULT_THEME: FarmNativeTheme = FARM_NATIVE_THEME;
// The theme the exported resolvers read while they run; they are synchronous.
let THEME: FarmNativeTheme = DEFAULT_THEME;

function withTheme<T>(theme: FarmNativeTheme | undefined, run: () => T): T {
  const previous = THEME;
  THEME = theme ?? DEFAULT_THEME;
  try {
    return run();
  } finally {
    THEME = previous;
  }
}

function spacing(value: string): FarmNativeValue | undefined {
  if (value === "px") return 1;
  if (value === "auto") return "auto";
  if (!/^\d+(?:\.5)?$/.test(value)) return undefined;
  return Number(value) * THEME.spacing;
}

function size(value: string): FarmNativeValue | undefined {
  if (value === "full") return "100%";
  const fraction = /^(\d+)\/(\d+)$/.exec(value);
  if (fraction) return `${Math.round((Number(fraction[1]) / Number(fraction[2])) * 1e4) / 100}%`;
  return spacing(value);
}

function color(value: string): string | undefined {
  const [name, alpha] = value.split("/");
  if (name === "transparent") return "transparent";
  if (name === "current" || name === "inherit") return "currentColor";
  const hex = THEME.colors[name!];
  if (!hex) return undefined;
  if (alpha === undefined) return hex;
  if (!/^\d{1,3}$/.test(alpha) || Number(alpha) > 100) return undefined;
  return `${hex}${Math.round((Number(alpha) / 100) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/** One utility, without variants, or `undefined` when the native tier cannot draw it. */
function utility(token: string): FarmNativeStyle | undefined {
  if (DROPPED.test(token)) return {};
  switch (token) {
    case "flex":
      return { display: "flex", flexDirection: "row" };
    case "flex-row":
      return { flexDirection: "row" };
    case "flex-col":
      return { flexDirection: "column" };
    case "flex-1":
      return { flexGrow: 1, flexShrink: 1, flexBasis: 0 };
    case "flex-auto":
      return { flexGrow: 1, flexShrink: 1 };
    case "flex-initial":
      return { flexGrow: 0, flexShrink: 1 };
    case "flex-none":
      return { flexGrow: 0, flexShrink: 0 };
    case "grow":
      return { flexGrow: 1 };
    case "grow-0":
      return { flexGrow: 0 };
    case "shrink":
      return { flexShrink: 1 };
    case "shrink-0":
      return { flexShrink: 0 };
    case "flex-nowrap":
    case "table-auto":
    case "table-fixed":
    case "border-collapse":
      return {};
    case "flex-wrap":
      return { flexWrap: "wrap" };
    case "hidden":
      return { display: "none" };
    case "overflow-hidden":
      return { overflow: "hidden" };
    case "overflow-visible":
      return { overflow: "visible" };
    case "italic":
      return { fontStyle: "italic" };
    case "not-italic":
      return { fontStyle: "normal" };
    case "underline":
      return { textDecorationLine: "underline" };
    case "line-through":
      return { textDecorationLine: "line-through" };
    case "no-underline":
      return { textDecorationLine: "none" };
    case "uppercase":
    case "lowercase":
    case "capitalize":
      return { textTransform: token };
    case "normal-case":
      return { textTransform: "none" };
    case "text-left":
    case "text-center":
    case "text-right":
    case "text-justify":
      return { textAlign: token.slice(5) };
    case "rounded":
      return each(
        ALL_CORNERS.map((corner) => `border${corner}Radius`),
        THEME.radius.sm!,
      );
    case "border":
      return {
        ...each(
          ALL_SIDES.map((side) => `border${side}Width`),
          1,
        ),
        ...each(
          ALL_SIDES.map((side) => `border${side}Color`),
          "currentColor",
        ),
      };
    case "border-solid":
    case "border-dashed":
    case "border-dotted":
      return { borderStyle: token.slice(7) };
    case "border-none":
      return { borderStyle: "none" };
  }

  let match = /^(items|justify|self)-([a-z]+)$/.exec(token);
  if (match) {
    const value = ALIGN[match[2]!];
    if (!value) return undefined;
    const key = { items: "alignItems", justify: "justifyContent", self: "alignSelf" }[match[1]!]!;
    return { [key]: value };
  }
  match = /^(-?)(p|m)([trblxyse]?)-(.+)$/.exec(token);
  if (match) {
    const value = spacing(match[4]!);
    if (value === undefined || (match[2] === "p" && (value === "auto" || match[1])))
      return undefined;
    const signed = match[1] && typeof value === "number" ? -value : value;
    const property = match[2] === "p" ? "padding" : "margin";
    const sides: readonly string[] = match[3] ? SIDES[match[3] as keyof typeof SIDES] : ALL_SIDES;
    return each(
      sides.map((side) => `${property}${side}`),
      signed,
    );
  }
  match = /^gap(-[xy])?-(.+)$/.exec(token);
  if (match) {
    const value = spacing(match[2]!);
    if (typeof value !== "number") return undefined;
    if (match[1] === "-x") return { columnGap: value };
    if (match[1] === "-y") return { rowGap: value };
    return { rowGap: value, columnGap: value };
  }
  match = /^(w|h|size|min-w|min-h|max-h)-(.+)$/.exec(token);
  if (match) {
    const value = size(match[2]!);
    if (value === undefined || (value === "auto" && match[1]!.includes("-"))) return undefined;
    if (match[1] === "size") return { width: value, height: value };
    const key = {
      w: "width",
      h: "height",
      "min-w": "minWidth",
      "min-h": "minHeight",
      "max-h": "maxHeight",
    }[match[1]!]!;
    return value === "auto" ? {} : { [key]: value };
  }
  match = /^max-w-(.+)$/.exec(token);
  if (match) {
    if (match[1] === "none") return {};
    if (match[1] === "full") return { maxWidth: "100%" };
    const value = THEME.container[match[1]!];
    return value === undefined ? undefined : { maxWidth: value };
  }
  match = /^text-(.+)$/.exec(token);
  if (match) {
    const text = THEME.text[match[1]!];
    if (text) {
      return Number.isFinite(text[1])
        ? { fontSize: text[0], lineHeight: text[1] }
        : { fontSize: text[0] };
    }
    const value = color(match[1]!);
    return value === undefined ? undefined : { color: value };
  }
  match = /^font-(.+)$/.exec(token);
  if (match) {
    if (match[1] === "sans" || match[1] === "serif" || match[1] === "mono") {
      return { fontFamily: match[1] };
    }
    const weight = THEME.fontWeight[match[1]!];
    return weight === undefined ? undefined : { fontWeight: weight };
  }
  match = /^leading-(.+)$/.exec(token);
  if (match) {
    if (match[1] === "none") return { lineHeightScale: 1 };
    const scale = THEME.leading[match[1]!];
    if (scale !== undefined) return { lineHeightScale: scale };
    const value = spacing(match[1]!);
    return typeof value === "number" ? { lineHeightPx: value } : undefined;
  }
  match = /^tracking-(.+)$/.exec(token);
  if (match) {
    const value = THEME.tracking[match[1]!];
    return value === undefined ? undefined : { letterSpacing: value };
  }
  match = /^bg-(.+)$/.exec(token);
  if (match) {
    const value = color(match[1]!);
    return value === undefined ? undefined : { backgroundColor: value };
  }
  match = /^border-([trblxy])$/.exec(token);
  if (match) {
    return each(
      SIDES[match[1] as keyof typeof SIDES].map((side) => `border${side}Width`),
      1,
    );
  }
  match = /^border(?:-([trblxy]))?-(.+)$/.exec(token);
  if (match) {
    const sides: readonly string[] = match[1] ? SIDES[match[1] as keyof typeof SIDES] : ALL_SIDES;
    if (/^(?:0|2|4|8)$/.test(match[2]!)) {
      return Object.fromEntries(sides.map((side) => [`border${side}Width`, Number(match![2])]));
    }
    const value = color(match[2]!);
    if (value === undefined) return undefined;
    return Object.fromEntries(sides.map((side) => [`border${side}Color`, value]));
  }
  match = /^rounded(?:-([trbl]{1,2}))?(?:-([a-z0-9]+))?$/.exec(token);
  if (match) {
    const radius =
      match[2] === undefined
        ? THEME.radius.sm!
        : match[2] === "none"
          ? 0
          : match[2] === "full"
            ? 9999
            : THEME.radius[match[2]];
    if (radius === undefined) return undefined;
    const corners = match[1] ? CORNERS[match[1]] : [...ALL_CORNERS];
    if (!corners) return undefined;
    return Object.fromEntries(corners.map((corner) => [`border${corner}Radius`, radius]));
  }
  match = /^opacity-(\d{1,3})$/.exec(token);
  if (match && Number(match[1]) <= 100) return { opacity: Number(match[1]) / 100 };
  return undefined;
}

/**
 * Why the native tier cannot draw this class, or `undefined` when it can. The analyzer reports
 * it for native-tier pages; responsive and state variants, arbitrary values, and anything not
 * listed here keep the page off the native tier.
 */
export function farmNativeClassProblem(token: string, theme?: FarmNativeTheme): string | undefined {
  return withTheme(theme, () => classProblem(token));
}

function classProblem(token: string): string | undefined {
  const parts = token.split(":");
  const base = parts.pop()!.replace(/^!/, "");
  if (parts.some((variant) => variant !== "dark")) {
    return `"${token}" needs a variant the native tier cannot apply`;
  }
  if (base.includes("[")) return `"${token}" is an arbitrary value`;
  return utility(base) === undefined ? `class "${token}" has no native-tier style` : undefined;
}

/** Resolve a `class` attribute. `unsupported` lists the classes that did not resolve. */
export function resolveFarmNativeClasses(
  className: string,
  theme?: FarmNativeTheme,
): FarmNativeStyles & {
  unsupported: string[];
} {
  return withTheme(theme, () => resolveClasses(className));
}

function resolveClasses(className: string): FarmNativeStyles & { unsupported: string[] } {
  const light: FarmNativeStyle[] = [];
  const darkParts: FarmNativeStyle[] = [];
  // A theme color whose value changes in dark mode gives its class a dark style of its own; an
  // explicit `dark:` class still wins.
  const themedDark: FarmNativeStyle[] = [];
  const darkTheme = THEME.darkColors
    ? { ...THEME, colors: { ...THEME.colors, ...THEME.darkColors } }
    : undefined;
  const unsupported: string[] = [];
  for (const token of className.split(/\s+/)) {
    if (!token) continue;
    if (classProblem(token)) {
      unsupported.push(token);
      continue;
    }
    const parts = token.split(":");
    const base = parts.pop()!.replace(/^!/, "");
    const resolved = utility(base)!;
    (parts.length > 0 ? darkParts : light).push(resolved);
    if (parts.length === 0 && darkTheme) {
      const lightTheme = THEME;
      THEME = darkTheme;
      const dark = utility(base);
      THEME = lightTheme;
      if (dark && JSON.stringify(dark) !== JSON.stringify(resolved)) themedDark.push(dark);
    }
  }
  // As in Tailwind, a utility that sets fewer sides wins over a broader one, whatever the class
  // order: `px-4 p-2` keeps 16px on the sides. A sort by key count is stable for the rest.
  const merge = (parts: FarmNativeStyle[]) =>
    Object.assign(
      {},
      ...parts.sort((left, right) => Object.keys(right).length - Object.keys(left).length),
    ) as FarmNativeStyle;
  const style = merge(light);
  const dark = { ...merge(themedDark), ...merge(darkParts) };
  return { style, ...(Object.keys(dark).length > 0 ? { dark } : {}), unsupported };
}

/** Shorthand keys as the longhands class styles use, so a shell reads one form. */
function longhands(style: FarmNativeStyle): FarmNativeStyle {
  const [[key, value]] = Object.entries(style) as [[string, FarmNativeValue]];
  if (key === "gap") return { rowGap: value, columnGap: value };
  if (key === "borderWidth")
    return each(
      ALL_SIDES.map((side) => `border${side}Width`),
      value,
    );
  if (key === "borderColor")
    return each(
      ALL_SIDES.map((side) => `border${side}Color`),
      value,
    );
  if (key === "borderRadius") {
    return each(
      ALL_CORNERS.map((corner) => `border${corner}Radius`),
      value,
    );
  }
  return style;
}

const PX = /^(-?\d*\.?\d+)px$/;

function cssLength(value: string): FarmNativeValue | undefined {
  if (value === "0") return 0;
  if (value === "auto") return "auto";
  const px = PX.exec(value);
  if (px) return Number(px[1]);
  if (/^-?\d*\.?\d+%$/.test(value)) return value;
  const rem = /^(-?\d*\.?\d+)rem$/.exec(value);
  return rem ? Number(rem[1]) * 16 : undefined;
}

const CSS_LENGTHS = new Set(
  (
    "gap row-gap column-gap padding-top padding-right padding-bottom padding-left margin-top " +
    "margin-right margin-bottom margin-left width height min-width min-height max-width " +
    "max-height border-width border-top-width border-right-width border-bottom-width " +
    "border-left-width border-radius font-size line-height letter-spacing flex-basis"
  ).split(" "),
);
const CSS_KEYWORDS: Record<string, ReadonlySet<string>> = {
  display: new Set(["flex", "none"]),
  "flex-direction": new Set(["row", "column"]),
  "align-items": new Set(["flex-start", "flex-end", "center", "stretch", "baseline"]),
  "align-self": new Set(["auto", "flex-start", "flex-end", "center", "stretch", "baseline"]),
  "justify-content": new Set([
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ]),
  "font-style": new Set(["normal", "italic"]),
  "text-align": new Set(["left", "center", "right", "justify"]),
  "text-transform": new Set(["none", "uppercase", "lowercase", "capitalize"]),
  "text-decoration-line": new Set(["none", "underline", "line-through"]),
  "border-style": new Set(["solid", "dashed", "dotted", "none"]),
  overflow: new Set(["hidden", "visible"]),
};
const CSS_COLORS = new Set(["color", "background-color", "border-color"]);
const CSS_NUMBERS = new Set(["opacity", "flex-grow", "flex-shrink", "font-weight"]);
const SHORTHAND_SIDES = ["Top", "Right", "Bottom", "Left"];

/** Inline style keys, as React names them, that the native tier draws. */
export const FARM_NATIVE_STYLE_PROPERTIES: ReadonlySet<string> = new Set(
  [
    ...CSS_LENGTHS,
    ...CSS_COLORS,
    ...CSS_NUMBERS,
    ...Object.keys(CSS_KEYWORDS),
    "padding",
    "margin",
    "flex",
    "flex-wrap",
  ].map((property) => property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())),
);

function camel(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function cssColor(value: string): string | undefined {
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value.toLowerCase();
  if (value === "transparent" || value === "currentcolor") {
    return value === "currentcolor" ? "currentColor" : value;
  }
  const rgb = /^rgba?\((\d{1,3})[ ,]+(\d{1,3})[ ,]+(\d{1,3})(?:[ ,/]+([\d.]+%?))?\)$/i.exec(value);
  if (!rgb) return value === "white" ? "#ffffff" : value === "black" ? "#000000" : undefined;
  const hex = rgb
    .slice(1, 4)
    .map((channel) => Math.min(255, Number(channel)).toString(16).padStart(2, "0"))
    .join("");
  if (rgb[4] === undefined) return `#${hex}`;
  const alpha = rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
  return `#${hex}${Math.round(Math.min(1, alpha) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

const IGNORED_PROPERTIES = new Set([
  // A native table always lays out like `table-layout: fixed`, its cells' borders side by side.
  "border-collapse",
  "table-layout",
  // No effect on a static, touch-only screen, or the shell owns it.
  "cursor",
  "outline",
  "outline-offset",
  "user-select",
  "-webkit-user-select",
  "-webkit-tap-highlight-color",
  "pointer-events",
  "box-sizing",
  "color-scheme",
  "appearance",
  "-webkit-appearance",
  "transition",
  "transition-property",
  "transition-duration",
  "transition-timing-function",
  "will-change",
  "-webkit-font-smoothing",
  "-moz-osx-font-smoothing",
  "text-rendering",
]);
const BORDER_STYLES = new Set(["solid", "dashed", "dotted", "none"]);

function sides(property: string, values: FarmNativeValue[]): FarmNativeStyle {
  const [top, right = top, bottom = top, left = right] = values;
  const ordered = [top, right, bottom, left];
  return Object.fromEntries(
    SHORTHAND_SIDES.map((side, index) => [property.replace("*", side), ordered[index]!]),
  );
}

/** `border: 1px solid #ddd` and its per-side forms, in any order. */
function border(value: string, side: string): FarmNativeStyle | undefined {
  const keys = side ? [side] : SHORTHAND_SIDES;
  if (value === "none" || value === "0")
    return each(
      keys.map((key) => `border${key}Width`),
      0,
    );
  let width: FarmNativeValue | undefined;
  let style: string | undefined;
  let color: string | undefined;
  for (const part of value.split(/\s+(?![^(]*\))/)) {
    if (BORDER_STYLES.has(part)) style = part;
    else if (cssLength(part) !== undefined && width === undefined) width = cssLength(part);
    else if (part === "thin") width = 1;
    else if (cssColor(part)) color = cssColor(part);
    else return undefined;
  }
  return {
    ...each(
      keys.map((key) => `border${key}Width`),
      style === "none" ? 0 : (width ?? 3),
    ),
    ...(color
      ? each(
          keys.map((key) => `border${key}Color`),
          color,
        )
      : {}),
    ...(style ? { borderStyle: style } : {}),
  };
}

/**
 * One CSS declaration as native style: the style, `null` when it has no effect on a native screen
 * (`cursor`, `color: inherit`), or `undefined` when the native tier cannot draw it.
 */
export function resolveFarmNativeDeclaration(
  property: string,
  value: string,
): FarmNativeStyle | null | undefined {
  if (IGNORED_PROPERTIES.has(property) || value === "inherit" || value === "unset") return null;
  switch (property) {
    case "padding":
    case "margin": {
      const parts = value.split(/\s+/).map(cssLength);
      if (parts.length > 4 || parts.some((part) => part === undefined)) return undefined;
      if (property === "padding" && parts.includes("auto")) return undefined;
      return sides(`${property}*`, parts as FarmNativeValue[]);
    }
    case "gap": {
      const parts = value.split(/\s+/).map(cssLength);
      if (parts.length > 2 || parts.some((part) => typeof part !== "number")) return undefined;
      return { rowGap: parts[0]!, columnGap: parts[1] ?? parts[0]! };
    }
    case "border-radius": {
      const parts = value.split(/\s+/).map(cssLength);
      if (parts.length > 4 || parts.some((part) => typeof part !== "number")) return undefined;
      const [a, b = a, c = a, d = b] = parts as number[];
      return {
        borderTopLeftRadius: a!,
        borderTopRightRadius: b!,
        borderBottomRightRadius: c!,
        borderBottomLeftRadius: d!,
      };
    }
    case "border":
      return border(value, "");
    case "border-top":
    case "border-right":
    case "border-bottom":
    case "border-left":
      return border(value, property[7]!.toUpperCase() + property.slice(8));
    case "background-color": {
      const parsed = cssColor(value);
      return parsed ? { backgroundColor: parsed } : undefined;
    }
    case "background": {
      const parsed = cssColor(value);
      if (parsed) return { backgroundColor: parsed };
      // The shorthand resets the color. `none` and a zero position, which minifiers write for
      // `transparent`, set nothing else a native view draws.
      return value.split(/\s+/).every((part) => /^(?:none|0(?:%|px)?)$/.test(part))
        ? { backgroundColor: "transparent" }
        : undefined;
    }
    case "display":
      if (value === "flex" || value === "inline-flex") return { display: "flex" };
      if (value === "block" || value === "flow-root") return {};
      return value === "none" ? { display: "none" } : undefined;
    case "flex-wrap":
      return value === "nowrap" ? {} : value === "wrap" ? { flexWrap: "wrap" } : undefined;
    case "flex":
      if (/^\d+$/.test(value)) return { flexGrow: Number(value), flexShrink: 1, flexBasis: 0 };
      if (value === "none") return { flexGrow: 0, flexShrink: 0 };
      if (value === "auto") return { flexGrow: 1, flexShrink: 1 };
      return undefined;
    case "font":
      return undefined;
    case "font-family":
      return {
        fontFamily: /mono/.test(value)
          ? "mono"
          : /(?:^|,\s*)serif\b|georgia|times/.test(value)
            ? "serif"
            : "sans",
      };
    case "font-weight":
      if (value === "bold") return { fontWeight: 700 };
      if (value === "normal") return { fontWeight: 400 };
      return /^\d{3}$/.test(value) ? { fontWeight: Number(value) } : undefined;
    case "line-height":
      if (/^\d*\.?\d+$/.test(value)) return { lineHeightScale: Number(value) };
      if (value === "normal") return null;
      return typeof cssLength(value) === "number" ? { lineHeightPx: cssLength(value)! } : undefined;
    case "text-decoration":
    case "text-decoration-line":
      return CSS_KEYWORDS["text-decoration-line"]!.has(value)
        ? { textDecorationLine: value }
        : undefined;
    case "list-style":
    case "list-style-type":
      return value === "none" ? null : undefined;
    case "align-items":
    case "align-self":
    case "justify-content":
      value = value === "start" ? "flex-start" : value === "end" ? "flex-end" : value;
      break;
    case "text-align":
      value = value === "start" ? "left" : value === "end" ? "right" : value;
      break;
  }
  if (CSS_LENGTHS.has(property)) {
    const length = cssLength(value);
    return length === undefined ? undefined : longhands({ [camel(property)]: length });
  }
  if (CSS_COLORS.has(property)) {
    const parsed = cssColor(value);
    return parsed ? longhands({ [camel(property)]: parsed }) : undefined;
  }
  if (CSS_NUMBERS.has(property)) {
    return /^\d*\.?\d+$/.test(value) ? { [camel(property)]: Number(value) } : undefined;
  }
  if (CSS_KEYWORDS[property]?.has(value)) return { [camel(property)]: value };
  return undefined;
}

/** Split `a: 1; b: url(x;y)` into declarations, keeping parentheses together. */
export function splitFarmCssDeclarations(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let depth = 0;
  let start = 0;
  const push = (end: number) => {
    const text = css.slice(start, end);
    const colon = text.indexOf(":");
    if (colon > 0) {
      out.push([
        text.slice(0, colon).trim().toLowerCase(),
        text
          .slice(colon + 1)
          .replace(/\s*!important\s*$/i, "")
          .trim(),
      ]);
    }
  };
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      push(index);
      start = index + 1;
    }
  }
  push(css.length);
  return out;
}

/** Replace `var(--x, fallback)` with the stylesheet's value, or `undefined` if one is missing. */
export function substituteFarmNativeVars(
  value: string,
  vars: Record<string, string>,
  depth = 0,
): string | undefined {
  if (!value.includes("var(")) return value;
  if (depth > 8) return undefined;
  let missing = false;
  const replaced = value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g,
    (_, name: string, fallback?: string) => {
      const resolved = vars[name] ?? fallback?.trim();
      if (resolved === undefined) {
        missing = true;
        return "";
      }
      return resolved;
    },
  );
  return missing ? undefined : substituteFarmNativeVars(replaced, vars, depth + 1);
}

/**
 * Resolve an inline `style` attribute, as React renders a style object (`padding:12px;color:#111`).
 * A `var(--x, fallback)` value, as `@farm.js/ui` writes its color tokens, reads the app's `:root`
 * variables in each theme, then its fallback; `dark` keeps only what the dark theme changes.
 * `unsupported` lists the declarations that did not resolve.
 */
export function resolveFarmNativeInlineStyle(
  css: string,
  vars: { light: Readonly<Record<string, string>>; dark: Readonly<Record<string, string>> } = {
    light: {},
    dark: {},
  },
): {
  style: FarmNativeStyle;
  dark: FarmNativeStyle;
  unsupported: string[];
} {
  const style: FarmNativeStyle = {};
  const dark: FarmNativeStyle = {};
  const unsupported: string[] = [];
  const themes = [
    [style, vars.light],
    [dark, { ...vars.light, ...vars.dark }],
  ] as const;
  for (const [property, raw] of splitFarmCssDeclarations(css)) {
    if (!property) continue;
    for (const [target, themeVars] of themes) {
      const value = substituteFarmNativeVars(raw, themeVars)?.toLowerCase();
      const resolved =
        value === undefined ? undefined : resolveFarmNativeDeclaration(property, value);
      if (resolved === undefined) {
        unsupported.push(`${property}: ${raw.toLowerCase()}`);
        break;
      }
      if (resolved) Object.assign(target, resolved);
    }
  }
  for (const key of Object.keys(dark)) {
    if (dark[key] === style[key]) delete dark[key];
  }
  return { style, dark, unsupported };
}

/** An `oklch(L% C H)` or `oklch(L C H)` color as sRGB hex, as Tailwind 4 writes its colors. */
function oklchToHex(value: string): string | undefined {
  const match =
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+|none)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(
      value,
    );
  if (!match) return undefined;
  const l = Number(match[1]) / (match[2] ? 100 : 1);
  const c = Number(match[3]);
  const h = ((match[4] === "none" ? 0 : Number(match[4])) * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const hex = linear
    .map((channel) => {
      const clamped = Math.min(1, Math.max(0, channel));
      const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(gamma * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("");
  if (match[5] === undefined) return `#${hex}`;
  const alpha = Number(match[5]) / (match[6] ? 100 : 1);
  return `#${hex}${Math.round(Math.min(1, alpha) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

function themeColor(value: string): string | undefined {
  const parsed = cssColor(value.toLowerCase());
  if (parsed && parsed !== "currentColor") return parsed;
  return oklchToHex(value.toLowerCase());
}

function themeLength(value: string): number | undefined {
  const length = cssLength(value.trim());
  return typeof length === "number" ? length : undefined;
}

/**
 * An app's Tailwind theme on top of the default one, from the declarations in its `@theme` blocks
 * (`--color-brand: oklch(...)`, `--spacing: 0.25rem`, `--radius-card: 12px`, `--color-*: initial`).
 * A value that reads a variable (`var(--background)`, as `@theme inline` does) takes the app's
 * `:root` value, and its dark-mode value under `prefers-color-scheme: dark`. A value it cannot
 * resolve leaves the class undefined, so it is reported rather than guessed.
 */
export function createFarmNativeTheme(
  declarations: ReadonlyArray<readonly [name: string, value: string]>,
  vars: { light: Readonly<Record<string, string>>; dark: Readonly<Record<string, string>> } = {
    light: {},
    dark: {},
  },
): FarmNativeTheme {
  const theme = {
    spacing: DEFAULT_THEME.spacing,
    colors: { ...DEFAULT_THEME.colors } as Record<string, string>,
    darkColors: {} as Record<string, string>,
    text: { ...DEFAULT_THEME.text } as Record<string, readonly [number, number]>,
    fontWeight: { ...DEFAULT_THEME.fontWeight } as Record<string, number>,
    tracking: { ...DEFAULT_THEME.tracking } as Record<string, number>,
    leading: { ...DEFAULT_THEME.leading } as Record<string, number>,
    radius: { ...DEFAULT_THEME.radius } as Record<string, number>,
    container: { ...DEFAULT_THEME.container } as Record<string, number>,
  };
  const namespaces: Array<[prefix: string, key: keyof typeof theme]> = [
    ["color-", "colors"],
    ["text-", "text"],
    ["font-weight-", "fontWeight"],
    ["tracking-", "tracking"],
    ["leading-", "leading"],
    ["radius-", "radius"],
    ["container-", "container"],
  ];
  const resolve = (value: string, scheme: "light" | "dark", depth = 0): string | undefined => {
    const reference = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
    if (!reference) return value.trim();
    if (depth > 8) return undefined;
    const name = reference[1]!;
    const next =
      (scheme === "dark" ? (vars.dark[name] ?? vars.light[name]) : vars.light[name]) ??
      reference[2];
    return next === undefined ? undefined : resolve(next, scheme, depth + 1);
  };
  const lineHeights: Array<[size: string, value: string]> = [];
  for (const [rawName, value] of declarations) {
    const name = rawName.replace(/^--/, "");
    if (value.trim() === "initial") {
      if (name === "*") {
        for (const [, key] of namespaces) theme[key] = {} as never;
        continue;
      }
      // `--color-*`, `--color-gray-*`, or one value such as `--color-brand`.
      for (const [prefix, key] of namespaces) {
        if (!name.startsWith(prefix)) continue;
        const rest = name.slice(prefix.length);
        const values = theme[key] as Record<string, unknown>;
        if (rest.endsWith("*")) {
          for (const entry of Object.keys(values)) {
            if (entry.startsWith(rest.slice(0, -1))) delete values[entry];
          }
        } else delete values[rest];
      }
      continue;
    }
    const light = resolve(value, "light");
    if (name === "spacing") {
      const px = light === undefined ? undefined : themeLength(light);
      if (px !== undefined) theme.spacing = px;
      continue;
    }
    if (name.startsWith("color-")) {
      const key = name.slice(6);
      const color = light === undefined ? undefined : themeColor(light);
      const darkValue = resolve(value, "dark");
      const dark = darkValue === undefined ? undefined : themeColor(darkValue);
      // Unresolved: the class has no value, so it is reported.
      delete theme.colors[key];
      delete theme.darkColors[key];
      if (color) theme.colors[key] = color;
      if (color && dark && dark !== color) theme.darkColors[key] = dark;
      continue;
    }
    const lineHeight = /^text-(.+)--line-height$/.exec(name);
    if (lineHeight) {
      if (light !== undefined) lineHeights.push([lineHeight[1]!, light]);
      continue;
    }
    if (name.startsWith("text-") && !name.includes("--")) {
      const px = light === undefined ? undefined : themeLength(light);
      const key = name.slice(5);
      if (px === undefined) delete theme.text[key];
      // Without `--text-*--line-height`, Tailwind sets only the size.
      else theme.text[key] = [px, theme.text[key]?.[1] ?? Number.NaN];
      continue;
    }
    const numeric: Array<[prefix: string, key: "fontWeight" | "leading"]> = [
      ["font-weight-", "fontWeight"],
      ["leading-", "leading"],
    ];
    const number = numeric.find(([prefix]) => name.startsWith(prefix));
    if (number) {
      const parsed = light === undefined ? Number.NaN : Number(light);
      const key = name.slice(number[0].length);
      if (Number.isFinite(parsed)) theme[number[1]][key] = parsed;
      else delete theme[number[1]][key];
      continue;
    }
    if (name.startsWith("tracking-")) {
      const em = light === undefined ? undefined : /^(-?[\d.]+)em$/.exec(light.trim());
      const key = name.slice(9);
      if (em) theme.tracking[key] = Number(em[1]);
      else delete theme.tracking[key];
      continue;
    }
    for (const [prefix, key] of [
      ["radius-", "radius"],
      ["container-", "container"],
    ] as const) {
      if (!name.startsWith(prefix)) continue;
      const px = light === undefined ? undefined : themeLength(light);
      if (px === undefined) delete theme[key][name.slice(prefix.length)];
      else theme[key][name.slice(prefix.length)] = px;
    }
  }
  // `--text-xl--line-height`: a ratio of the size, `calc(a / b)`, or a length.
  for (const [size, value] of lineHeights) {
    const text = theme.text[size];
    if (!text) continue;
    const calc = /^calc\(\s*([\d.]+)\s*\/\s*([\d.]+)\s*\)$/.exec(value.trim());
    const ratio = calc ? Number(calc[1]) / Number(calc[2]) : Number(value);
    const px = Number.isFinite(ratio)
      ? Math.round(ratio * text[0] * 1000) / 1000
      : themeLength(value);
    if (px !== undefined) theme.text[size] = [text[0], px];
  }
  const { darkColors, ...rest } = theme;
  return Object.keys(darkColors).length > 0 ? { ...rest, darkColors } : rest;
}
