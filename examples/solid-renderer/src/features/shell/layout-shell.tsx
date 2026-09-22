"use client";

import { createSignal } from "solid-js";
import type { JSX } from "solid-js";

/**
 * A client layout that owns state.
 *
 * Layout state is the thing a client navigation is supposed to leave alone:
 * the shell stays mounted while only the page below it changes. This component
 * makes that observable so an end-to-end test can assert it.
 */
export function LayoutShell(props: { children?: JSX.Element }) {
  const [count, setCount] = createSignal(0);

  return (
    <div class="layout-shell">
      <nav class="shell-nav" aria-label="Example routes">
        <a href="/">home</a>
        <span aria-hidden="true">/</span>
        <a href="/about">about</a>
        <button type="button" data-testid="counter" onClick={() => setCount(count() + 1)}>
          count: {count()}
        </button>
      </nav>
      {props.children}
    </div>
  );
}
