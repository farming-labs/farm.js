"use client";
import { Link } from "@farm.js/core/client";

export default function BrokenError() {
  return (
    <section>
      <h1>Something broke</h1>
      <p data-testid="error-boundary">The page failed to render.</p>
      <Link href="/next/target">Leave the broken page</Link>
    </section>
  );
}
