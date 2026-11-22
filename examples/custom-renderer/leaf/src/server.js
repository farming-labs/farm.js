// leaf/server: renders an element tree to an HTML string. Effects never run on the server and
// state keeps its initial value.

import { Fragment, internals, toChildArray } from "./index.js";
import {
  RESERVED,
  VOID_ELEMENTS,
  attributeName,
  cssName,
  isEventProp,
  styleValue,
} from "./props.js";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

const serverDispatcher = {
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useMemo: (compute) => compute(),
};

function renderStyle(style) {
  if (typeof style === "string") return style;
  return Object.entries(style)
    .filter(([, value]) => value != null && value !== false && value !== "")
    .map(([name, value]) => `${cssName(name)}:${styleValue(name, value)}`)
    .join(";");
}

function renderAttributes(type, props) {
  let html = "";
  for (let [name, value] of Object.entries(props)) {
    if (RESERVED.has(name) || value == null || value === false || isEventProp(name, value))
      continue;
    if (typeof value === "function") continue;
    // An uncontrolled field starts from its default, as React renders it.
    if (name === "defaultValue") {
      if (type === "textarea" || "value" in props) continue;
      name = "value";
    } else if (name === "defaultChecked") {
      if ("checked" in props) continue;
      name = "checked";
    } else if (type === "textarea" && name === "value") {
      continue;
    }
    if (name === "style") {
      const css = renderStyle(value);
      if (css) html += ` style="${escapeHtml(css)}"`;
      continue;
    }
    if (typeof value === "object") continue;
    html +=
      value === true
        ? ` ${attributeName(name)}=""`
        : ` ${attributeName(name)}="${escapeHtml(value)}"`;
  }
  return html;
}

function renderNode(node) {
  if (typeof node === "string") return escapeHtml(node);
  const { type, props } = node;
  if (typeof type === "function") {
    const output = internals.render(type, props, serverDispatcher);
    if (output && typeof output.then === "function") {
      throw new Error(
        `leaf can't render async components: ${type.name || "a component"} returned a promise.`,
      );
    }
    return renderChildren(output);
  }
  if (type === Fragment) return renderChildren(props.children);
  if (typeof type !== "string") {
    throw new TypeError(`leaf can't render an element whose type is ${String(type)}.`);
  }
  const open = `<${type}${renderAttributes(type, props)}>`;
  if (VOID_ELEMENTS.has(type)) return open;
  const inner = props.dangerouslySetInnerHTML
    ? String(props.dangerouslySetInnerHTML.__html ?? "")
    : type === "textarea"
      ? escapeHtml(props.value ?? props.defaultValue ?? "")
      : renderChildren(props.children);
  return `${open}${inner}</${type}>`;
}

function renderChildren(children) {
  let html = "";
  for (const child of toChildArray(children)) html += renderNode(child);
  return html;
}

export function renderToString(element) {
  return renderChildren(element);
}
