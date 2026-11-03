/**
 * Tailwind classes and inline styles as native style values, for the native tier: the server
 * renders a page, and the shell draws native views from it. Values come from Tailwind's default
 * theme (`native-theme.ts`); lengths are px, which the shell scales to dp or points.
 *
 * The analyzer checks a native-tier page with {@link farmNativeClassProblem}, so a class it lets
 * through always resolves here.
 */
import { FARM_NATIVE_THEME as THEME } from "./native-theme";

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
  const hex = (THEME.colors as Record<string, string>)[name!];
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
      return {};
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
        THEME.radius.sm,
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
    const value = (THEME.container as Record<string, number>)[match[1]!];
    return value === undefined ? undefined : { maxWidth: value };
  }
  match = /^text-(.+)$/.exec(token);
  if (match) {
    const text = (THEME.text as Record<string, readonly [number, number]>)[match[1]!];
    if (text) return { fontSize: text[0], lineHeight: text[1] };
    const value = color(match[1]!);
    return value === undefined ? undefined : { color: value };
  }
  match = /^font-(.+)$/.exec(token);
  if (match) {
    if (match[1] === "sans" || match[1] === "serif" || match[1] === "mono") {
      return { fontFamily: match[1] };
    }
    const weight = (THEME.fontWeight as Record<string, number>)[match[1]!];
    return weight === undefined ? undefined : { fontWeight: weight };
  }
  match = /^leading-(.+)$/.exec(token);
  if (match) {
    if (match[1] === "none") return { lineHeightScale: 1 };
    const scale = (THEME.leading as Record<string, number>)[match[1]!];
    if (scale !== undefined) return { lineHeightScale: scale };
    const value = spacing(match[1]!);
    return typeof value === "number" ? { lineHeightPx: value } : undefined;
  }
  match = /^tracking-(.+)$/.exec(token);
  if (match) {
    const value = (THEME.tracking as Record<string, number>)[match[1]!];
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
        ? THEME.radius.sm
        : match[2] === "none"
          ? 0
          : match[2] === "full"
            ? 9999
            : (THEME.radius as Record<string, number>)[match[2]];
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
export function farmNativeClassProblem(token: string): string | undefined {
  const parts = token.split(":");
  const base = parts.pop()!.replace(/^!/, "");
  if (parts.some((variant) => variant !== "dark")) {
    return `"${token}" needs a variant the native tier cannot apply`;
  }
  if (base.includes("[")) return `"${token}" is an arbitrary value`;
  return utility(base) === undefined ? `class "${token}" has no native-tier style` : undefined;
}

/** Resolve a `class` attribute. `unsupported` lists the classes that did not resolve. */
export function resolveFarmNativeClasses(className: string): FarmNativeStyles & {
  unsupported: string[];
} {
  const light: FarmNativeStyle[] = [];
  const darkParts: FarmNativeStyle[] = [];
  const unsupported: string[] = [];
  for (const token of className.split(/\s+/)) {
    if (!token) continue;
    if (farmNativeClassProblem(token)) {
      unsupported.push(token);
      continue;
    }
    const parts = token.split(":");
    (parts.length > 1 ? darkParts : light).push(utility(parts.pop()!.replace(/^!/, ""))!);
  }
  // As in Tailwind, a utility that sets fewer sides wins over a broader one, whatever the class
  // order: `px-4 p-2` keeps 16px on the sides. A sort by key count is stable for the rest.
  const merge = (parts: FarmNativeStyle[]) =>
    Object.assign(
      {},
      ...parts.sort((left, right) => Object.keys(right).length - Object.keys(left).length),
    ) as FarmNativeStyle;
  const style = merge(light);
  return { style, ...(darkParts.length > 0 ? { dark: merge(darkParts) } : {}), unsupported };
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

/**
 * Resolve an inline `style` attribute, as React renders a style object (`padding:12px;color:#111`).
 * `unsupported` lists the declarations that did not resolve.
 */
export function resolveFarmNativeInlineStyle(css: string): {
  style: FarmNativeStyle;
  unsupported: string[];
} {
  const style: FarmNativeStyle = {};
  const unsupported: string[] = [];
  for (const declaration of css.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .trim()
      .toLowerCase();
    if (!property) continue;
    let resolved: FarmNativeStyle | undefined;
    if (property === "padding" || property === "margin") {
      const parts = value.split(/\s+/).map(cssLength);
      if (parts.length <= 4 && parts.every((part) => part !== undefined)) {
        const [top, right = top, bottom = top, left = right] = parts;
        const values = [top, right, bottom, left];
        resolved = Object.fromEntries(
          SHORTHAND_SIDES.map((side, index) => [`${property}${side}`, values[index]!]),
        );
      }
    } else if (CSS_LENGTHS.has(property)) {
      const length = cssLength(value);
      if (length !== undefined) resolved = { [camel(property)]: length };
    } else if (CSS_COLORS.has(property)) {
      const parsed = cssColor(value);
      if (parsed) resolved = { [camel(property)]: parsed };
    } else if (CSS_NUMBERS.has(property)) {
      if (/^\d*\.?\d+$/.test(value)) resolved = { [camel(property)]: Number(value) };
    } else if (CSS_KEYWORDS[property]?.has(value)) {
      resolved = { [camel(property)]: value };
    } else if (property === "flex" && /^\d+$/.test(value)) {
      resolved = { flexGrow: Number(value), flexShrink: 1, flexBasis: 0 };
    }
    if (resolved) Object.assign(style, longhands(resolved));
    else unsupported.push(`${property}: ${value}`);
  }
  return { style, unsupported };
}
