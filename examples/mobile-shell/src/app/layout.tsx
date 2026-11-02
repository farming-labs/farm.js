import type { LayoutProps, Metadata } from "@farm.js/core";
import { Link } from "@farm.js/core/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Notes",
  description: "Farm.js mobile shell spike: native tabs and stacks around Farm pages",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <>
      {/* Browsers get web chrome. The shell sets data-platform and draws native tabs instead. */}
      <nav className="web-only web-tabs">
        <Link href="/notes">Notes</Link>
        <Link href="/settings">Settings</Link>
      </nav>
      <main className="page">{children}</main>
    </>
  );
}
