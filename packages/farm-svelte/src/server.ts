import { render } from "svelte/server";
import type { Component } from "svelte";
import CompatRoot from "./generated/compat-root.server";
import SvelteCompat, {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
} from "./runtime";

export const name = "svelte";
export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement };

/** Svelte hydration markers are already included in the server-rendered body. */
export function generateHydrationScript(): string {
  return "";
}

export async function renderToString(element: unknown): Promise<string> {
  const rendered = render(CompatRoot as Component<{ element: unknown }>, { props: { element } });
  return rendered.body;
}

export default SvelteCompat;
