import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Field Notes | Farm Content",
  description: "Typed local content collections with Farm.js",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Field Notes home">
          <span aria-hidden="true">F/</span> Field Notes
        </a>
        <span className="edition">Issue 01 · 2026</span>
      </header>
      <main>{children}</main>
      <footer>
        <span>Built from local Markdown</span>
        <code>@farm.js/content</code>
      </footer>
    </div>
  );
}
