import { Link } from "@farm.js/core/client";

// No client component here, so this page never hydrates: each Link is server HTML, and the
// router's click handler navigates it with the options Link writes into it.
export default function LinkOptionsPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Link options without hydration</h1>
      <nav className="flex flex-col gap-2">
        <Link href="/link-options-e2e?step=push" data-testid="link-push">
          Push
        </Link>
        <Link href="/link-options-e2e?step=replace" replace data-testid="link-replace">
          Replace
        </Link>
        <Link href="/link-options-e2e?step=transition" viewTransition data-testid="link-transition">
          View transition
        </Link>
      </nav>
      <div style={{ height: "200vh" }} />
      <nav className="flex flex-col gap-2">
        <Link href="/link-options-e2e?step=top" data-testid="link-scroll">
          Scroll to top
        </Link>
        <Link href="/link-options-e2e?step=stay" scroll={false} data-testid="link-no-scroll">
          Keep scroll
        </Link>
      </nav>
    </main>
  );
}
