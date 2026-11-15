import { Link } from "@farm.js/core/client";

// No client component here, so this page never hydrates: each Link is server HTML that the
// router prefetches from the mode Link writes into it.
export default function StaticPrefetchPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Link prefetch without hydration</h1>
      <nav className="flex flex-col gap-2">
        <Link href="/about?static=intent" prefetch="intent" data-testid="static-intent">
          Intent
        </Link>
        <Link href="/about?static=none" prefetch="none" data-testid="static-none">
          None
        </Link>
        <Link href="/about?static=render" prefetch="render" data-testid="static-render">
          Render
        </Link>
        <Link href="/" prefetch="none" data-testid="static-home">
          Home
        </Link>
      </nav>
      <div style={{ height: "200vh" }} />
      <Link href="/about?static=viewport" prefetch="viewport" data-testid="static-viewport">
        Viewport
      </Link>
    </main>
  );
}
