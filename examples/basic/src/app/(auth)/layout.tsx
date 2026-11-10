"use client";

import type { LayoutProps } from "@farm.js/core";
import { Link } from "@farm.js/core/client";
import { useState } from "react";

// A route group layout: it wraps only the pages inside `(auth)`, nested in the root
// layout. It stays mounted while you move between /sign-in and /sign-up, so its
// state survives those navigations.
export default function AuthLayout({ children }: LayoutProps) {
  const [visits, setVisits] = useState(0);

  return (
    <section data-testid="auth-layout" className="mx-auto max-w-md space-y-6">
      <nav className="flex gap-4 text-sm">
        <Link href="/sign-in" data-testid="auth-link-sign-in">
          Sign in
        </Link>
        <Link href="/sign-up" data-testid="auth-link-sign-up">
          Sign up
        </Link>
        <Link href="/cart" data-testid="auth-link-cart">
          Cart
        </Link>
      </nav>
      <button
        type="button"
        data-testid="auth-layout-counter"
        onClick={() => setVisits((value) => value + 1)}
      >
        Layout clicks: {visits}
      </button>
      {children}
    </section>
  );
}
