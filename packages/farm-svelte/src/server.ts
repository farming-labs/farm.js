import { render } from "svelte/server";
import type { Component } from "svelte";
import CompatRoot from "./generated/compat-root.server";
import SvelteCompat, {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
  markFunctionComponent,
} from "./runtime";

export const name = "svelte";
export const capabilities = {
  streaming: { node: false, web: false },
  functionComponents: true,
} as const;
export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement, markFunctionComponent };

/** Svelte hydration markers are already included in the server-rendered body. */
export function generateHydrationScript(): string {
  return "";
}

/** Farm passes the response's CSP nonce, which Svelte puts on its hydration scripts. */
interface FarmSvelteRenderOptions {
  nonce?: string;
}

function renderSvelte(element: unknown, options: FarmSvelteRenderOptions | undefined) {
  return render(CompatRoot as Component<{ element: unknown }>, {
    props: { element },
    ...(options?.nonce ? { csp: { nonce: options.nonce } } : {}),
  });
}

export async function renderToString(
  element: unknown,
  options?: FarmSvelteRenderOptions,
): Promise<string> {
  return renderSvelte(element, options).body;
}

/**
 * Svelte components can emit document-head markup through <svelte:head>;
 * Farm injects the returned head into the assembled document.
 */
export async function renderToStringWithHead(
  element: unknown,
  options?: FarmSvelteRenderOptions,
): Promise<{ html: string; head: string }> {
  const rendered = renderSvelte(element, options);
  return { html: rendered.body, head: rendered.head };
}

export default SvelteCompat;
