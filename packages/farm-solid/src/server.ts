import { generateHydrationScript, renderToStringAsync } from "solid-js/web";
import SolidCompat, {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
  materializeSolidElement,
} from "./runtime";

export const name = "solid";
export const capabilities = {
  streaming: { node: false, web: false },
} as const;
export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement };
export { generateHydrationScript };

export async function renderToString(element: unknown): Promise<string> {
  return renderToStringAsync(() => materializeSolidElement(element));
}

export default SolidCompat;
