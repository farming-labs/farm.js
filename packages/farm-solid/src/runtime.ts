import {
  ErrorBoundary as SolidErrorBoundary,
  Suspense as SolidSuspense,
  createComponent,
} from "solid-js";
import { Dynamic } from "solid-js/web";

const FARM_SOLID_ELEMENT = Symbol.for("farm.solid.element");
const FARM_SOLID_FRAGMENT = Symbol.for("farm.solid.fragment");

export interface FarmSolidElement {
  readonly [FARM_SOLID_ELEMENT]: true;
  readonly type: unknown;
  readonly props: Record<string, unknown> | null;
  readonly children: readonly unknown[];
}

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

function normalizeProps(element: FarmSolidElement): Record<string, unknown> {
  const props = { ...element.props };

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
  }

  return props;
}

export function materializeSolidElement(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(materializeSolidElement);
  if (!isFarmSolidElement(value)) return value;

  if (value.type === FARM_SOLID_FRAGMENT) {
    return value.children.map(materializeSolidElement);
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
  return materializeSolidElement(createComponent(Component, props));
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
  return materializeSolidElement(Component(normalizeProps(value)));
}

const SolidCompat = {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
};

export default SolidCompat;
