import type { ReactNode } from "react";
import { Link } from "@farm.js/core/client";

export const metadata = { title: "Server components contract" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <nav aria-label="Contract pages">
        <Link href="/">Home</Link> <Link href="/children">Children</Link>{" "}
        <Link href="/context">Context</Link> <Link href="/async">Async</Link>{" "}
        <Link href="/stream">Stream</Link> <Link href="/meta">Meta</Link>{" "}
        <Link href="/action">Action</Link> <Link href="/nav/a">Nav</Link>{" "}
        <Link href="/static/a">Static</Link> <Link href="/window">Window</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
