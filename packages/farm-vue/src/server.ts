import { createSSRApp, defineComponent } from "vue";
import { renderToString as renderVueToString } from "@vue/server-renderer";
import VueCompat, {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
  materializeVueElement,
} from "./runtime";

export const name = "vue";
export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement };

/** Vue hydration does not require an inline bootstrap before the client entry. */
export function generateHydrationScript(): string {
  return "";
}

export async function renderToString(element: unknown): Promise<string> {
  const app = createSSRApp(
    defineComponent({
      name: "FarmVueServerRoot",
      setup: () => () => materializeVueElement(element),
    }),
  );
  return renderVueToString(app);
}

export default VueCompat;
