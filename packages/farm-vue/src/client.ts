import {
  createApp,
  createSSRApp,
  defineComponent,
  shallowRef,
  type App,
  type ShallowRef,
} from "vue";
import VueCompat, {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
  materializeVueElement,
} from "./runtime";

export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement };

export interface FarmVueRoot {
  render(element: unknown): void;
  unmount(): void;
}

function createManagedRoot(
  container: Element,
  initialElement?: unknown,
  hydration = false,
): FarmVueRoot {
  let app: App<Element> | undefined;
  let current: ShallowRef<unknown> | undefined;

  const mount = (element: unknown, hydrate: boolean) => {
    current = shallowRef(element);
    const Root = defineComponent({
      name: "FarmVueClientRoot",
      setup: () => () => materializeVueElement(current!.value),
    });
    app = hydrate ? createSSRApp(Root) : createApp(Root);
    app.mount(container);
  };

  if (arguments.length >= 2) mount(initialElement, hydration);

  return {
    render(element) {
      if (current) {
        current.value = element;
      } else {
        mount(element, false);
      }
    },
    unmount() {
      app?.unmount();
      app = undefined;
      current = undefined;
      container.replaceChildren();
    },
  };
}

export function createRoot(container: Element): FarmVueRoot {
  return createManagedRoot(container);
}

export function hydrateRoot(container: Element, element: unknown): FarmVueRoot {
  return createManagedRoot(container, element, true);
}

export default VueCompat;
