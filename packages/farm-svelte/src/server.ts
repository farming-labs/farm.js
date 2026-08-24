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
export const capabilities = {
  streaming: { node: false, web: false },
} as const;
export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement };

/** Svelte hydration markers are already included in the server-rendered body. */
export function generateHydrationScript(): string {
  return "";
}

export async function renderToString(element: unknown): Promise<string> {
  const rendered = render(CompatRoot as Component<{ element: unknown }>, { props: { element } });
  return rendered.body;
}

/**
 * Svelte components can emit document-head markup through <svelte:head>;
 * Farm injects the returned head into the assembled document.
 */
export async function renderToStringWithHead(
  element: unknown,
): Promise<{ html: string; head: string }> {
  const rendered = render(CompatRoot as Component<{ element: unknown }>, { props: { element } });
  return { html: rendered.body, head: rendered.head };
}

export default SvelteCompat;
