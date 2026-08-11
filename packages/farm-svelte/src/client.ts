import { hydrate as hydrateSvelte, mount, unmount } from "svelte";
import type { Component } from "svelte";
import CompatRoot from "./generated/compat-root.client";
import SvelteCompat, {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
} from "./runtime";

export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement };

export interface FarmSvelteRoot {
  render(element: unknown): void;
  unmount(): void;
}

function createManagedRoot(
  container: Element,
  initialElement?: unknown,
  hydration = false,
): FarmSvelteRoot {
  let instance: Record<string, unknown> | undefined;
  const Root = CompatRoot as Component<{ element: unknown }>;

  const renderElement = (element: unknown, hydrate: boolean) => {
    if (instance) {
      void unmount(instance);
      instance = undefined;
    }
    if (!hydrate) container.replaceChildren();
    instance = hydrate
      ? hydrateSvelte(Root, { target: container, props: { element } })
      : mount(Root, { target: container, props: { element } });
  };

  if (arguments.length >= 2) renderElement(initialElement, hydration);

  return {
    render(element) {
      renderElement(element, false);
    },
    unmount() {
      if (instance) void unmount(instance);
      instance = undefined;
      container.replaceChildren();
    },
  };
}

export function createRoot(container: Element): FarmSvelteRoot {
  return createManagedRoot(container);
}

export function hydrateRoot(container: Element, element: unknown): FarmSvelteRoot {
  return createManagedRoot(container, element, true);
}

export default SvelteCompat;
