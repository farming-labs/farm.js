"use client";

import type { LayoutProps, Metadata } from "@farm.js/core";
import { createSignal } from "solid-js";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARMJS Solid renderer",
  description: "Solid SSR, hydration, and colocated FARMJS server primitives",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

export default function RootLayout(props: LayoutProps) {
  const [count, setCount] = createSignal(0);

  return (
    <>
      <header class="layout-state">
        <button type="button" data-layout-counter onClick={() => setCount((value) => value + 1)}>
          Layout count: {count()}
        </button>
        <nav aria-label="Example pages">
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
      </header>
      {props.children}
    </>
  );
}
