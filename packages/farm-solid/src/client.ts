import { hydrate as solidHydrate, render as solidRender } from "solid-js/web";
import SolidCompat, {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
  materializeSolidRoot,
} from "./runtime";

export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement };

export interface FarmSolidRoot {
  render(element: unknown): void;
  unmount(): void;
}

function inferHydrationRenderId(firstHydratableElement: HTMLElement | null): string | undefined {
  const hydrationKey = firstHydratableElement?.dataset.hk;

  // A resumed component's first hydration key is `${renderId}0`. FARMJS may render
  // framework-owned page/layout wrappers before entering the selected
  // renderer, so the Solid subtree can have a non-empty renderId.
  return hydrationKey?.endsWith("0") ? hydrationKey.slice(0, -1) : undefined;
}

function createManagedRoot(
  container: Element,
  element?: unknown,
  hydration = false,
): FarmSolidRoot {
  let dispose: (() => void) | undefined;

  const mount = (next: unknown, shouldHydrate: boolean) => {
    dispose?.();
    if (!shouldHydrate) container.replaceChildren();
    const factory = () => materializeSolidRoot(next) as any;
    if (!shouldHydrate) {
      dispose = solidRender(factory, container);
      return;
    }

    const firstHydratableElement = container.querySelector<HTMLElement>("[data-hk]");
    dispose = solidHydrate(factory, container, {
      renderId: inferHydrationRenderId(firstHydratableElement),
    });

    // Renderer-neutral FARMJS wrappers can introduce a hydration-context
    // prefix that Solid cannot recover from a nested page container alone. If
    // Solid replaced the first server node instead of claiming it, remount the
    // subtree normally so it is interactive rather than leaving detached
    // event handlers behind.
    if (firstHydratableElement && !container.contains(firstHydratableElement)) {
      dispose();
      container.replaceChildren();
      dispose = solidRender(factory, container);
    }
  };

  if (arguments.length >= 2) mount(element, hydration);

  return {
    render(next) {
      mount(next, false);
    },
    unmount() {
      dispose?.();
      dispose = undefined;
      container.replaceChildren();
    },
  };
}

export function createRoot(container: Element): FarmSolidRoot {
  return createManagedRoot(container);
}

export function hydrateRoot(container: Element, element: unknown): FarmSolidRoot {
  return createManagedRoot(container, element, true);
}

export default SolidCompat;
