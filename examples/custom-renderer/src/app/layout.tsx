"use client";

import type { LayoutProps, Metadata } from "@farm.js/core";
import { Link } from "farm-leaf/bindings";
import { useEffect, useState } from "leaf";

export const metadata: Metadata = {
  title: "leaf on Farm",
  description: "A custom renderer: leaf renders every route, and Farm does the rest.",
};

export default function RootLayout(props: LayoutProps) {
  // Survives client navigation: the layout stays mounted and leaf patches the page below it.
  const [visits, setVisits] = useState(0);
  // Effects run once leaf has hydrated the root; the e2e tests wait for this attribute.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <div className="shell" data-hydrated={hydrated ? "true" : undefined}>
      <header>
        <nav aria-label="Pages">
          <Link href="/">Home</Link>
          <Link href="/about">About</Link>
          <Link href="/crops/wheat">Wheat</Link>
          <Link href="/notes">Notes</Link>
          <Link href="/streaming">Streaming</Link>
        </nav>
        <button type="button" id="layout-counter" onClick={() => setVisits((n) => n + 1)}>
          Layout clicks: {visits}
        </button>
      </header>
      <main>{props.children}</main>
    </div>
  );
}
