const FARM_SVELTE_ELEMENT = Symbol.for("farm.svelte.element");
const FARM_SVELTE_FRAGMENT = Symbol.for("farm.svelte.fragment");
const FARM_SVELTE_SUSPENSE = Symbol.for("farm.svelte.suspense");
const FARM_SVELTE_ERROR_BOUNDARY = Symbol.for("farm.svelte.error-boundary");

export interface FarmSvelteElement {
  readonly [FARM_SVELTE_ELEMENT]: true;
  readonly type: unknown;
  readonly props: Record<string, unknown> | null;
  readonly children: readonly unknown[];
}

export const Fragment = FARM_SVELTE_FRAGMENT;
export const Suspense = FARM_SVELTE_SUSPENSE;
export const ErrorBoundary = FARM_SVELTE_ERROR_BOUNDARY;

export function createElement(
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
): FarmSvelteElement {
  return {
    [FARM_SVELTE_ELEMENT]: true,
    type,
    props: props || null,
    children,
  };
}

export function isFarmSvelteElement(value: unknown): value is FarmSvelteElement {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Partial<FarmSvelteElement>)[FARM_SVELTE_ELEMENT] === true,
  );
}

export function isValidElement(value: unknown): boolean {
  return isFarmSvelteElement(value) || Array.isArray(value);
}

export function getFarmSvelteChildren(element: FarmSvelteElement): unknown[] {
  if (element.children.length > 0) return [...element.children];
  const propChildren = element.props?.children;
  if (propChildren === undefined || propChildren === null) return [];
  return Array.isArray(propChildren) ? [...propChildren] : [propChildren];
}

export function normalizeFarmSvelteProps(element: FarmSvelteElement): Record<string, unknown> {
  const props = { ...element.props };
  delete props.children;
  delete props.suppressHydrationWarning;

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
  if (props.style && typeof props.style === "object" && !Array.isArray(props.style)) {
    props.style = Object.entries(props.style as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined && value !== false)
      .map(([name, value]) => {
        const property = name.startsWith("--")
          ? name
          : name
              .replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
              .replace(/^ms-/, "-ms-");
        return `${property}: ${String(value)}`;
      })
      .join("; ");
  }

  for (const key of Object.keys(props)) {
    if (/^on[A-Z]/.test(key)) {
      const svelteEventName = `on${key.slice(2).toLowerCase()}`;
      if (!(svelteEventName in props)) props[svelteEventName] = props[key];
      delete props[key];
    }
  }

  return props;
}

const SvelteCompat = {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
};

export default SvelteCompat;
