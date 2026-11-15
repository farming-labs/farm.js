import { Link } from "@farm.js/core/client";

// Behaviors Next.js's App Router tests check (test/e2e/app-dir): links for client navigations.
export default function NextBehaviors() {
  return (
    <section>
      <h1>Next behaviors</h1>
      <ul>
        <li>
          <Link href="/next/not-found-page">To not found</Link>
        </li>
        <li>
          <Link href="/next/redirect">To redirect</Link>
        </li>
        <li>
          <Link href="/next/broken">To broken</Link>
        </li>
        <li>
          <Link href="/next/target">To target</Link>
        </li>
        <li>
          <Link href="/next/query?name=%E4%BD%A0%E5%A5%BD">To unicode query</Link>
        </li>
      </ul>
    </section>
  );
}
