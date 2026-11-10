import {
  ErrorBoundary as SolidErrorBoundary,
  Suspense as SolidSuspense,
  createComponent,
  sharedConfig,
} from "solid-js";
import { Dynamic, isServer } from "solid-js/web";

const FARM_SOLID_ELEMENT = Symbol.for("farm.solid.element");
const FARM_SOLID_FRAGMENT = Symbol.for("farm.solid.fragment");

export interface FarmSolidElement {
  readonly [FARM_SOLID_ELEMENT]: true;
  readonly type: unknown;
  readonly props: Record<string, unknown> | null;
  readonly children: readonly unknown[];
}

/**
 * Written by the server on a FARMJS island container: the Solid hydration
 * context id of the island's root component, which the client passes to
 * `hydrate` as its `renderId`.
 */
export const FARM_SOLID_RENDER_ID_ATTRIBUTE = "data-farm-solid-render-id";

export const Fragment = FARM_SOLID_FRAGMENT;
export const Suspense = SolidSuspense;

export function ErrorBoundary(props: {
  Fallback: (props: Record<string, unknown>) => unknown;
  fallbackProps?: Record<string, unknown>;
  children?: unknown;
}) {
  return createComponent(SolidErrorBoundary, {
    fallback(error, reset) {
      return createComponent(props.Fallback as any, {
        ...props.fallbackProps,
        error,
        reset,
      });
    },
    get children() {
      return materializeSolidElement(props.children) as any;
    },
  });
}

export function createElement(
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
): FarmSolidElement {
  return {
    [FARM_SOLID_ELEMENT]: true,
    type,
    props: props || null,
    children,
  };
}

export function isFarmSolidElement(value: unknown): value is FarmSolidElement {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Partial<FarmSolidElement>)[FARM_SOLID_ELEMENT] === true,
  );
}

export function isValidElement(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false;
}

function rejectAsyncComponentResult(value: unknown): unknown {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    throw new TypeError(
      "FARMJS Solid renderer does not support async function components. Resolve async data before rendering the component.",
    );
  }
  return value;
}

// CSS properties whose numeric values are unitless in React's style objects.
const UNITLESS_STYLE_PROPERTIES = new Set([
  "animation-iteration-count",
  "aspect-ratio",
  "border-image-outset",
  "border-image-slice",
  "border-image-width",
  "column-count",
  "columns",
  "fill-opacity",
  "flex",
  "flex-grow",
  "flex-shrink",
  "flood-opacity",
  "font-weight",
  "grid-area",
  "grid-column",
  "grid-column-end",
  "grid-column-start",
  "grid-row",
  "grid-row-end",
  "grid-row-start",
  "line-clamp",
  "line-height",
  "opacity",
  "order",
  "orphans",
  "scale",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "tab-size",
  "widows",
  "z-index",
  "zoom",
]);

function farmStyleObjectToCss(style: Record<string, unknown>): string {
  return Object.entries(style)
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([name, value]) => {
      const property = name.startsWith("--")
        ? name
        : name
            .replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
            .replace(/^ms-/, "-ms-");
      // React appends px to non-zero numbers outside the unitless set.
      const cssValue =
        typeof value === "number" &&
        value !== 0 &&
        !property.startsWith("--") &&
        !UNITLESS_STYLE_PROPERTIES.has(property)
          ? `${value}px`
          : String(value);
      return `${property}: ${cssValue}`;
    })
    .join("; ");
}

function normalizeProps(element: FarmSolidElement): Record<string, unknown> {
  // Preserve accessors used by renderer-owned route state. Object spread
  // eagerly evaluates Solid props and would flatten page/param signals before
  // a compiled layout can subscribe to them.
  const props = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(element.props || {}),
  ) as Record<string, unknown>;

  if ("className" in props && !("class" in props)) {
    props.class = props.className;
    delete props.className;
  }
  if ("htmlFor" in props && !("for" in props)) {
    props.for = props.htmlFor;
    delete props.htmlFor;
  }
  if ("dangerouslySetInnerHTML" in props) {
    const html = props.dangerouslySetInnerHTML as { __html?: unknown } | undefined;
    props.innerHTML = html?.__html == null ? "" : String(html.__html);
    delete props.dangerouslySetInnerHTML;
  }
  // React-shaped style objects: camelCase keys, numeric px values. Serialize
  // to a CSS string so Solid renders them identically on server and client.
  if (props.style && typeof props.style === "object" && !Array.isArray(props.style)) {
    props.style = farmStyleObjectToCss(props.style as Record<string, unknown>);
  }
  // Solid's DOM event prop for dblclick is onDblClick.
  if ("onDoubleClick" in props && !("onDblClick" in props)) {
    props.onDblClick = props.onDoubleClick;
    delete props.onDoubleClick;
  }
  // React reconciliation metadata, never a DOM attribute.
  delete props.key;
  // React seeds uncontrolled inputs by rendering defaultValue/defaultChecked as
  // value/checked; Solid would otherwise emit a dead `defaultvalue` attribute.
  if ("defaultValue" in props && !("value" in props)) {
    props.value = props.defaultValue;
    delete props.defaultValue;
  }
  if ("defaultChecked" in props && !("checked" in props)) {
    props.checked = props.defaultChecked;
    delete props.defaultChecked;
  }
  delete props.suppressHydrationWarning;

  if (element.children.length > 0) {
    Object.defineProperty(props, "children", {
      configurable: true,
      enumerable: true,
      get() {
        const materialized = element.children.map(materializeSolidElement);
        return materialized.length === 1 ? materialized[0] : materialized;
      },
    });
  } else if ("children" in props) {
    // Children can also arrive as a prop rather than positionally: core wraps
    // every layout as `createElement(Layout, { children: element, ... })`, and
    // route slots pass their element through a prop too. The spread copied the
    // raw Farm element(s), which Solid would escape to the string "undefined",
    // so materialize them the same way as positional children.
    Object.defineProperty(props, "children", {
      configurable: true,
      enumerable: true,
      get() {
        return materializeSolidElement(element.props?.children);
      },
    });
  }

  return props;
}

/**
 * Marks a hydration context whose subtree the browser never hydrates. Solid
 * copies a context's own properties into every child context it creates, so
 * the mark reaches every component and Suspense rerun below it.
 */
const FARM_SOLID_SERVER_ONLY = Symbol.for("farm.solid.serverOnly");

/** The part of Solid's server hydration context FARMJS reads and extends. */
interface SolidServerContext {
  id: string;
  noHydrate?: boolean;
  serialize?(id: string, value: unknown, wait?: boolean): void;
  [FARM_SOLID_SERVER_ONLY]?: boolean;
}

function currentServerContext(): SolidServerContext | undefined {
  return sharedConfig.context as SolidServerContext | undefined;
}

/**
 * Solid serializes every resource (and boundary error) it resolves into the
 * document's hydration script. For a server-only segment that publishes data
 * the browser never reads: a layout resource can hold session details or
 * middleware locals. Wrap the root context's `serialize` (child contexts copy
 * it) to skip writes from a server-only context, the way Solid's own
 * `noHydrate` does. NoHydration itself is not usable here: it stops Solid from
 * giving child components their own contexts, so nested Suspense boundaries
 * share one id and lose their content.
 */
function installServerOnlySerialization(context: SolidServerContext): void {
  const serialize = context.serialize;
  if (!serialize) return;
  context.serialize = function (this: unknown, id, value, wait) {
    const current = currentServerContext();
    if (!current?.[FARM_SOLID_SERVER_ONLY] || current.noHydrate) {
      return serialize.call(this, id, value, wait);
    }
    // Solid still awaits a deferred stream resource; it just does not write it.
    current.noHydrate = true;
    try {
      return serialize.call(this, id, value, wait);
    } finally {
      current.noHydrate = false;
    }
  };
}

/** Render with the current context marked server-only or hydrating. */
function renderWithServerOnly<T>(serverOnly: boolean, render: () => T): T {
  const context = currentServerContext();
  if (!context || context[FARM_SOLID_SERVER_ONLY] === serverOnly) return render();
  const previous = context[FARM_SOLID_SERVER_ONLY];
  context[FARM_SOLID_SERVER_ONLY] = serverOnly;
  try {
    return render();
  } finally {
    context[FARM_SOLID_SERVER_ONLY] = previous;
  }
}

/** Host props whose children render with the given server-only mark. */
function serverHostProps(element: FarmSolidElement, serverOnly: boolean): Record<string, unknown> {
  const props = normalizeProps(element);
  const children = Object.getOwnPropertyDescriptor(props, "children")?.get;
  if (children) {
    Object.defineProperty(props, "children", {
      configurable: true,
      enumerable: true,
      get: () => renderWithServerOnly(serverOnly, children),
    });
  }
  return props;
}

/**
 * The client hydrates an island by calling its root component directly in a
 * hydration context it must name up front (see `materializeSolidRoot`). Record
 * the id Solid gives that component on the server and write it on the island
 * container. Guessing it from the first hydration key breaks as soon as the
 * component allocates an id before its first element, as `createUniqueId()`
 * does, and a missed guess falls back to a non-hydrating render.
 *
 * Core marks a page the browser does not hydrate with data-farm-client="false";
 * that page's data stays out of the document. Every other island hydrates.
 */
function materializeServerIsland(tag: string, element: FarmSolidElement): unknown {
  const serverOnly =
    element.props?.["data-farm-segment"] === "page" && element.props["data-farm-client"] !== "true";
  const root = element.children.length === 1 ? element.children[0] : undefined;
  if (!isFarmSolidElement(root) || typeof root.type !== "function") {
    return createComponent(Dynamic, { ...serverHostProps(element, serverOnly), component: tag });
  }

  const Component = root.type as (props: Record<string, unknown>) => unknown;
  let renderId: string | undefined;
  const recordingRoot = createElement(
    (props: Record<string, unknown>) => {
      const context = currentServerContext();
      if (context && !context.noHydrate) {
        renderId = context.id;
        // This component's own context, so the mark covers only the island.
        context[FARM_SOLID_SERVER_ONLY] = serverOnly;
      }
      return Component(props);
    },
    root.props,
    ...root.children,
  );
  // Spreading evaluates the children getter, which runs the root component.
  const props: Record<string, unknown> & { component: string } = {
    ...normalizeProps(createElement(tag, element.props, recordingRoot)),
    component: tag,
  };
  if (renderId !== undefined) props[FARM_SOLID_RENDER_ID_ATTRIBUTE] = renderId;
  return createComponent(Dynamic, props);
}

export function materializeSolidElement(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(materializeSolidElement);
  if (!isFarmSolidElement(value)) return value;

  if (value.type === FARM_SOLID_FRAGMENT) {
    return value.children.map(materializeSolidElement);
  }

  if (isServer && typeof value.type === "string" && value.props?.["data-farm-island"] != null) {
    return materializeServerIsland(value.type, value);
  }

  // A route slot hydrates in its own root, so it keeps its data even inside a
  // server-only layout.
  if (isServer && typeof value.type === "string" && value.props?.["data-farm-route-slot"] != null) {
    return createComponent(Dynamic, { ...serverHostProps(value, false), component: value.type });
  }

  const props = normalizeProps(value);
  if (typeof value.type === "string") {
    return createComponent(Dynamic, {
      ...props,
      component: value.type,
    });
  }

  if (typeof value.type !== "function") {
    throw new TypeError("FARMJS Solid renderer received an invalid component type.");
  }

  const Component = value.type as any;
  return materializeSolidElement(rejectAsyncComponentResult(createComponent(Component, props)));
}

function findPageBoundary(value: unknown, depth = 0): FarmSolidElement | undefined {
  if (depth > 64) return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findPageBoundary(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isFarmSolidElement(value)) return undefined;
  if (value.props?.["data-farm-segment"] === "page") return value;
  const fromChildren = findPageBoundary(value.children, depth + 1);
  if (fromChildren) return fromChildren;
  // Core passes a layout its child as a prop. Read plain values only: a getter
  // is renderer route state that must not be evaluated early.
  const children = value.props && Object.getOwnPropertyDescriptor(value.props, "children");
  return children && "value" in children ? findPageBoundary(children.value, depth + 1) : undefined;
}

/**
 * Materialize a server document. When no layout hydrates, the browser hydrates
 * only the page island and route slots, so everything else is server-only and
 * its resources stay out of the hydration script. When a layout hydrates, the
 * browser renders the whole layout chain and needs its data. Hydration keys
 * are unchanged either way.
 */
export function materializeSolidDocument(value: unknown): unknown {
  const context = isServer ? currentServerContext() : undefined;
  const page = context ? findPageBoundary(value) : undefined;
  if (context && page) {
    installServerOnlySerialization(context);
    if (page.props?.["data-farm-layout-client"] !== "true") {
      context[FARM_SOLID_SERVER_ONLY] = true;
    }
  }
  return materializeSolidElement(value);
}

/**
 * Enter a FARMJS-owned render root without adding another Solid component
 * context. The server has already entered that context while composing the
 * page with framework wrappers; the client resumes from its serialized id.
 */
export function materializeSolidRoot(value: unknown): unknown {
  if (!isFarmSolidElement(value) || typeof value.type !== "function") {
    return materializeSolidElement(value);
  }

  const Component = value.type as any;
  return materializeSolidElement(rejectAsyncComponentResult(Component(normalizeProps(value))));
}

const SolidCompat = {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
};

export default SolidCompat;
