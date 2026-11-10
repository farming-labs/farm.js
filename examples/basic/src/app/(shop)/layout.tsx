import type { LayoutProps } from "@farm.js/core";
import { Link } from "@farm.js/core/client";

// A sibling route group with its own layout. Moving here from `(auth)` swaps the
// group layout and keeps the root layout.
export default function ShopLayout({ children }: LayoutProps) {
  return (
    <section data-testid="shop-layout" className="space-y-6">
      <nav className="flex gap-4 text-sm">
        <Link href="/sign-in" data-testid="shop-link-sign-in">
          Sign in
        </Link>
        <Link href="/about" data-testid="shop-link-about">
          About
        </Link>
      </nav>
      {children}
    </section>
  );
}
