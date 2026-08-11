import { hydrate as preactHydrate, render as preactRender, type ComponentChild } from "preact";
import PreactCompat, {
  ErrorBoundary,
  Fragment,
  Suspense,
  createElement,
  isValidElement,
} from "./runtime";

export { ErrorBoundary, Fragment, Suspense, createElement, isValidElement };

export interface FarmPreactRoot {
  render(element: unknown): void;
  unmount(): void;
}

function renderInto(container: Element, element: unknown): void {
  preactRender(element as ComponentChild, container);
}

function createManagedRoot(container: Element): FarmPreactRoot {
  return {
    render(element) {
      renderInto(container, element);
    },
    unmount() {
      preactRender(null, container);
      container.replaceChildren();
    },
  };
}

export function createRoot(container: Element): FarmPreactRoot {
  return createManagedRoot(container);
}

export function hydrateRoot(container: Element, element: unknown): FarmPreactRoot {
  preactHydrate(element as ComponentChild, container);
  return createManagedRoot(container);
}

export default PreactCompat;
