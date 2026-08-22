import {
  Fragment as VueFragment,
  Suspense as VueSuspense,
  defineComponent,
  h,
  isVNode,
  onErrorCaptured,
  shallowRef,
  type Component,
  type PropType,
  type VNodeChild,
} from "vue";

const FARM_VUE_ELEMENT = Symbol.for("farm.vue.element");

export interface FarmVueElement {
  readonly [FARM_VUE_ELEMENT]: true;
  readonly type: unknown;
  readonly props: Record<string, unknown> | null;
  readonly children: readonly unknown[];
}

export const Fragment = VueFragment;
export const Suspense = VueSuspense;

export const ErrorBoundary = defineComponent({
  name: "FarmVueErrorBoundary",
  props: {
    Fallback: {
      type: [Object, Function] as PropType<Component>,
      required: true,
    },
    fallbackProps: {
      type: Object as PropType<Record<string, unknown>>,
      default: () => ({}),
    },
  },
  setup(props, { slots }) {
    const error = shallowRef<unknown>();
    const reset = () => {
      error.value = undefined;
    };

    onErrorCaptured((captured) => {
      error.value = captured;
      return false;
    });

    return () =>
      error.value === undefined
        ? slots.default?.()
        : h(props.Fallback, {
            ...props.fallbackProps,
            error: error.value,
            reset,
          });
  },
});

export function createElement(
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
): FarmVueElement {
  return {
    [FARM_VUE_ELEMENT]: true,
    type,
    props: props || null,
    children,
  };
}

export function isFarmVueElement(value: unknown): value is FarmVueElement {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Partial<FarmVueElement>)[FARM_VUE_ELEMENT] === true,
  );
}

export function isValidElement(value: unknown): boolean {
  return isFarmVueElement(value) || isVNode(value) || Boolean(value);
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

function normalizeProps(element: FarmVueElement): {
  props: Record<string, unknown>;
  children: unknown[];
} {
  const props = { ...element.props };
  const propChildren = props.children;
  delete props.children;

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
  // to a CSS string so Vue renders them identically on server and client.
  if (props.style && typeof props.style === "object" && !Array.isArray(props.style)) {
    props.style = farmStyleObjectToCss(props.style as Record<string, unknown>);
  }
  // Vue's DOM event prop for dblclick is onDblclick.
  if ("onDoubleClick" in props && !("onDblclick" in props)) {
    props.onDblclick = props.onDoubleClick;
    delete props.onDoubleClick;
  }
  delete props.suppressHydrationWarning;

  const sourceChildren = element.children.length
    ? element.children
    : propChildren === undefined
      ? []
      : Array.isArray(propChildren)
        ? propChildren
        : [propChildren];

  return {
    props,
    children: sourceChildren.map(materializeVueElement),
  };
}

function asVNodeChildren(children: unknown[]): VNodeChild {
  if (children.length === 0) return undefined;
  return children.length === 1 ? (children[0] as VNodeChild) : (children as VNodeChild[]);
}

export function materializeVueElement(value: unknown): VNodeChild {
  if (Array.isArray(value)) return value.map(materializeVueElement) as VNodeChild[];
  if (!isFarmVueElement(value)) return value as VNodeChild;

  const { props, children } = normalizeProps(value);

  if (value.type === VueFragment) {
    return h(VueFragment as any, null, asVNodeChildren(children) as any);
  }

  if (value.type === VueSuspense) {
    const fallback = materializeVueElement(props.fallback);
    delete props.fallback;
    return h(VueSuspense, props, {
      default: () => asVNodeChildren(children),
      fallback: () => fallback,
    });
  }

  if (typeof value.type === "string") {
    return h(value.type, props, asVNodeChildren(children) as any);
  }

  if ((typeof value.type !== "function" && typeof value.type !== "object") || !value.type) {
    throw new TypeError("FARMJS Vue renderer received an invalid component type.");
  }

  const slots = children.length
    ? {
        default: () => asVNodeChildren(children),
      }
    : undefined;
  return h(value.type as Component, props, slots);
}

const VueCompat = {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
};

export default VueCompat;
