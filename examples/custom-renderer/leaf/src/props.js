// What a prop means on the page, shared by the HTML and DOM renderers so both write the same
// attributes.

// CSS properties whose numbers have no unit, as React treats them.
const UNITLESS = new Set([
  "animationIterationCount",
  "aspectRatio",
  "columnCount",
  "flex",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "gridColumn",
  "gridRow",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "scale",
  "tabSize",
  "widows",
  "zIndex",
  "zoom",
]);

export function styleValue(name, value) {
  return typeof value === "number" && value !== 0 && !UNITLESS.has(name) ? `${value}px` : value;
}

export function cssName(name) {
  return name.startsWith("--")
    ? name
    : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

const ATTRIBUTE_NAMES = { className: "class", htmlFor: "for" };

export function attributeName(name) {
  return ATTRIBUTE_NAMES[name] ?? name;
}

/** `onClick` → `click`, `onDoubleClick` → `dblclick`; `onChange` on a field fires on input. */
export function eventName(name, tag) {
  const event = name.slice(2).toLowerCase();
  if (event === "doubleclick") return "dblclick";
  if (event === "change" && (tag === "input" || tag === "textarea")) return "input";
  return event;
}

export function isEventProp(name, value) {
  return name.length > 2 && name.startsWith("on") && typeof value === "function";
}

/** Props that are leaf's own bookkeeping, never attributes. */
export const RESERVED = new Set(["children", "dangerouslySetInnerHTML"]);

export const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
