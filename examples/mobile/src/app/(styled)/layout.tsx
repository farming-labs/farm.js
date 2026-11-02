import type { LayoutProps } from "@farm.js/core";
import { Link } from "@farm.js/core/client";
import "../globals.css";

export default function StyledLayout({ children }: LayoutProps) {
  return (
    <>
      {/* Web tabs. The Android shell draws native tabs too; it has no CSS hook to hide these yet. */}
      <nav className="web-tabs">
        <Link href="/">Home</Link>
        <Link href="/notes">Notes</Link>
        <Link href="/settings">Settings</Link>
      </nav>
      <main className="page">{children}</main>
    </>
  );
}
