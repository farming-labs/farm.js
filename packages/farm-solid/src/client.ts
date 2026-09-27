import type { FarmRendererRouteState } from "@farm.js/core/renderer";
import { createSignal, type Setter } from "solid-js";
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
  renderRoute(state: FarmRendererRouteState): void;
  unmount(): void;
}

interface ActiveSolidRoute {
  layouts: FarmRendererRouteState["layouts"];
  setState: Setter<FarmRendererRouteState>;
}

function hasSameLayouts(
  current: FarmRendererRouteState["layouts"],
  next: FarmRendererRouteState["layouts"],
): boolean {
  return (
    current.length === next.length &&
    current.every(
      (layout, index) =>
        layout.pattern === next[index]?.pattern && layout.Component === next[index]?.Component,
    )
  );
}

function createSolidRouteElement(readState: () => FarmRendererRouteState): unknown {
  const initialState = readState();
  let wrapped: unknown = null;

  for (let index = initialState.layouts.length - 1; index >= 0; index -= 1) {
    const layout = initialState.layouts[index]!;
    const child = wrapped;
    const props: Record<string, unknown> = {};
    Object.defineProperties(props, {
      children: {
        configurable: true,
        enumerable: true,
        get: index === initialState.layouts.length - 1 ? () => readState().page : () => child,
      },
      params: {
        configurable: true,
        enumerable: true,
        get: () => readState().params,
      },
    });
    wrapped = createElement(layout.Component, props);
    wrapped = createElement(
      "div",
      {
        "data-farm-layout-boundary": "true",
        "data-farm-layout-pattern": layout.pattern,
        style: { display: "contents" },
      },
      wrapped,
    );
  }

  const routeElement = initialState.layouts.length > 0 ? wrapped : initialState.page;
  return initialState.wrap ? initialState.wrap(routeElement) : routeElement;
}

function inferHydrationRenderId(firstHydratableElement: HTMLElement | null): string | undefined {
  const hydrationKey = firstHydratableElement?.dataset.hk;

  // FARMJS creates host elements through Solid's Dynamic component. Solid
  // allocates one context id for Dynamic and another for its host element, so
  // the first key is `${renderId}00`. Recover the owning render id rather than
  // resuming inside Dynamic's already-serialized component context.
  return hydrationKey?.endsWith("00") ? hydrationKey.slice(0, -2) : undefined;
}

function createManagedRoot(
  container: Element,
  element?: unknown,
  hydration = false,
  initialRouteState?: FarmRendererRouteState,
): FarmSolidRoot {
  let dispose: (() => void) | undefined;
  let activeRoute: ActiveSolidRoute | undefined;

  const mount = (next: unknown, shouldHydrate: boolean) => {
    dispose?.();
    activeRoute = undefined;
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

  const mountRoute = (state: FarmRendererRouteState, shouldHydrate: boolean) => {
    dispose?.();
    const [readState, setState] = createSignal(state, { equals: false });
    const routeElement = createSolidRouteElement(readState);
    activeRoute = { layouts: state.layouts, setState };
    if (!shouldHydrate) container.replaceChildren();
    const factory = () => materializeSolidRoot(routeElement) as any;
    if (!shouldHydrate) {
      dispose = solidRender(factory, container);
      return;
    }

    const firstHydratableElement = container.querySelector<HTMLElement>("[data-hk]");
    dispose = solidHydrate(factory, container, {
      renderId: inferHydrationRenderId(firstHydratableElement),
    });
    if (firstHydratableElement && !container.contains(firstHydratableElement)) {
      dispose();
      container.replaceChildren();
      dispose = solidRender(factory, container);
    }
  };

  if (initialRouteState) mountRoute(initialRouteState, hydration);
  else if (arguments.length >= 2) mount(element, hydration);

  return {
    render(next) {
      mount(next, false);
    },
    renderRoute(state) {
      if (activeRoute && hasSameLayouts(activeRoute.layouts, state.layouts)) {
        activeRoute.setState(state);
        return;
      }
      mountRoute(state, false);
    },
    unmount() {
      dispose?.();
      dispose = undefined;
      activeRoute = undefined;
      container.replaceChildren();
    },
  };
}

export function createRoot(container: Element): FarmSolidRoot {
  return createManagedRoot(container);
}

export function hydrateRoot(
  container: Element,
  element: unknown,
  routeState?: FarmRendererRouteState,
): FarmSolidRoot {
  return createManagedRoot(container, element, true, routeState);
}

export default SolidCompat;
