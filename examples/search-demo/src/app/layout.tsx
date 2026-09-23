import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: {
    default: "Farm Search",
    template: "%s · Farm Search",
  },
  description: "A build-time static search demo for Farm.js.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell">
      <header className="site-header" data-pagefind-ignore="all">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>Farm Search</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="/guides/server-functions">Server functions</a>
          <a href="/guides/routing">Routing</a>
          <a href="/guides/compiler">Compiler</a>
        </nav>
      </header>
      {children}
      <footer data-pagefind-ignore="all">
        Static, self-hosted, and rebuilt with the site.
      </footer>
    </div>
  );
}
