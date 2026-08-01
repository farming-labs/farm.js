import {
  render,
  type RenderOptions,
  type StrataDocument,
  type StrataElement,
  type StrataNode,
  type StrataTag,
} from "@farming-labs/strata";
import {
  StaticFragment,
  type StaticFragmentBoundary,
  type StaticFragmentProps,
} from "@farming-labs/strata/react-server";
import { createElement, Fragment, isValidElement, type ReactElement } from "react";

export type {
  RenderOptions,
  StrataDocument,
  StrataElement,
  StrataNode,
  StrataTag,
  StrataText,
} from "@farming-labs/strata";

export interface OptimizedBoundaryProps extends Omit<StaticFragmentProps, "content"> {
  /**
   * Typed host-only content. Client Components, refs, effects, and event
   * handlers must remain outside the boundary.
   */
  document: StrataDocument;
  renderOptions?: RenderOptions;
}

interface AutomaticOptimizedBoundaryProps extends Omit<StaticFragmentProps, "content"> {
  document: StrataDocument;
  fallback: ReactElement;
}

const AUTOMATIC_MIN_NODES = 8;
const AUTOMATIC_MIN_BYTES = 256;
const AUTOMATIC_BOUNDARIES = new Set<StaticFragmentBoundary>([
  "article",
  "aside",
  "div",
  "footer",
  "header",
  "main",
  "nav",
  "section",
  "span",
]);
const STRATA_TAGS = new Set<StrataTag>([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "wbr",
]);
const BOOLEAN_ATTRIBUTES = new Set(["hidden", "reversed"]);
const ATTRIBUTE_NAMES: Record<string, string> = {
  className: "class",
  colSpan: "colspan",
  dateTime: "datetime",
  rowSpan: "rowspan",
};

function AutomaticOptimizedBoundary({
  document,
  fallback,
  ...props
}: AutomaticOptimizedBoundaryProps): ReactElement {
  let content;
  try {
    content = render(document);
  } catch {
    return fallback;
  }
  if (content.nodeCount < AUTOMATIC_MIN_NODES && content.bytes < AUTOMATIC_MIN_BYTES) {
    return fallback;
  }
  return StaticFragment({ ...props, content });
}

function attributeValue(name: string, value: unknown): string | undefined | null {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value !== "boolean") return null;
  if (name.startsWith("aria-") || name.startsWith("data-")) return String(value);
  if (BOOLEAN_ATTRIBUTES.has(name)) return value ? "" : undefined;
  return null;
}

function convertAttributes(
  tag: StrataTag,
  props: Record<string, unknown>,
): Record<string, string> | null {
  const attributes: Record<string, string> = {};

  for (const [reactName, rawValue] of Object.entries(props)) {
    if (reactName === "children") continue;
    if (
      reactName === "dangerouslySetInnerHTML" ||
      reactName === "ref" ||
      reactName === "style" ||
      reactName === "suppressHydrationWarning" ||
      /^on[A-Z]/.test(reactName)
    ) {
      return null;
    }

    const name = ATTRIBUTE_NAMES[reactName] || reactName;
    const value = attributeValue(name, rawValue);
    if (value === null) return null;
    if (value !== undefined) attributes[name] = value;
  }

  return Object.keys(attributes).length > 0 ? attributes : {};
}

function automaticDocumentFromElement(element: ReactElement): StrataDocument | null {
  const rootProps = element.props as Record<string, unknown>;
  const children: StrataNode[] = [];
  if (!appendStrataNodes(rootProps.children, children)) return null;
  return { type: "document", ...(children.length > 0 ? { children } : {}) };
}

function appendStrataNodes(value: unknown, output: StrataNode[]): boolean {
  if (value === null || value === undefined || typeof value === "boolean") return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    output.push({ type: "text", value: String(value) });
    return true;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      if (!appendStrataNodes(child, output)) return false;
    }
    return true;
  }
  if (!isValidElement(value)) return false;

  const element = value as ReactElement;
  const props = element.props as Record<string, unknown>;
  if (element.type === Fragment) return appendStrataNodes(props.children, output);

  if (element.type === OptimizedBoundary || element.type === AutomaticOptimizedBoundary) {
    const boundary = props.as ?? "div";
    if (typeof boundary !== "string" || !STRATA_TAGS.has(boundary as StrataTag)) return false;
    const { as: _as, document: _document, fallback: _fallback, ...boundaryProps } = props;
    const attributes = convertAttributes(boundary as StrataTag, boundaryProps);
    if (!attributes) return false;
    const document = props.document as StrataDocument | undefined;
    if (!document || document.type !== "document") return false;
    output.push({
      type: "element",
      tag: boundary as StrataTag,
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      ...(document.children?.length ? { children: document.children } : {}),
    });
    return true;
  }

  if (typeof element.type !== "string" || !STRATA_TAGS.has(element.type as StrataTag)) {
    return false;
  }
  const tag = element.type as StrataTag;
  const attributes = convertAttributes(tag, props);
  if (!attributes) return false;
  const children: StrataNode[] = [];
  if (!appendStrataNodes(props.children, children)) return false;
  output.push({
    type: "element",
    tag,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...(children.length > 0 ? { children } : {}),
  } satisfies StrataElement);
  return true;
}

/**
 * Internal compiler target for automatic optimized boundaries. This helper is
 * deliberately fail-open: any unsupported or unsafe tree returns the original
 * React element unchanged.
 *
 * @internal
 */
export function _optimizeBoundary(element: ReactElement): ReactElement {
  if (
    !isValidElement(element) ||
    typeof element.type !== "string" ||
    !AUTOMATIC_BOUNDARIES.has(element.type as StaticFragmentBoundary)
  ) {
    return element;
  }

  const props = element.props as Record<string, unknown>;
  if (props.dangerouslySetInnerHTML !== undefined || props.ref !== undefined) return element;
  const document = automaticDocumentFromElement(element);
  if (!document) return element;

  const { children: _children, ...boundaryProps } = props;
  return createElement(AutomaticOptimizedBoundary, {
    ...boundaryProps,
    ...(element.key !== null ? { key: element.key } : {}),
    as: element.type as StaticFragmentBoundary,
    document,
    fallback: element,
  });
}

/**
 * Render a typed host-only document with the optimized native runtime and
 * place it inside an opaque React-owned boundary.
 *
 * Enable `experimental.optimizedBoundary` before importing this component.
 */
export function OptimizedBoundary({
  document,
  renderOptions,
  ...props
}: OptimizedBoundaryProps): ReactElement {
  const content = render(document, renderOptions);
  return StaticFragment({
    ...props,
    content,
  });
}

export type OptimizedBoundaryTag = StaticFragmentBoundary;
