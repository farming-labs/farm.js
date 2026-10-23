"use client";

import { useEffect, useState } from "react";
import { Link } from "@farm.js/core/client";

export default function RedirectE2EPage() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Redirect navigation</h1>
      <p data-testid="hydrated">{hydrated ? "yes" : "no"}</p>
      <ul className="space-y-2">
        <li>
          <Link href="/redirect-e2e/render">Page redirect</Link>
        </li>
        <li>
          <Link href="/redirect-e2e/async">Async page redirect</Link>
        </li>
        <li>
          <Link href="/redirect-e2e/guarded">Middleware redirect</Link>
        </li>
      </ul>
    </section>
  );
}
