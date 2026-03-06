import type { LayoutProps } from "@farmjs/core";
import { Link } from "@farmjs/core";
import "./globals.css";

export const metadata = {
  title: "Farm.js - Modern React meta-framework",
  description:
    "A modern React meta-framework built on Vite with Next.js-like semantics, React Server Components, and blazing-fast development.",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/docs"
            className="flex items-center gap-2 font-semibold text-slate-900 hover:text-emerald-600"
          >
            <span className="text-2xl" aria-hidden>
              🚜
            </span>
            <span>Farm.js</span>{" "}
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/docs"
              className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors"
            >
              Docs
            </Link>
            <Link
              href="/docs/getting-started"
              className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors"
            >
              Get Started
            </Link>
            <Link
              href="/docs/plugins"
              className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors"
            >
              Plugins
            </Link>
            <a
              href="https://github.com/farm-js/farm.js"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-slate-200 bg-white mt-auto">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <p className="text-center text-sm text-slate-500">
            Built with Farm.js ·{" "}
            <a
              href="https://github.com/farm-js/farm.js"
              className="text-emerald-600 hover:underline"
            >
              View on GitHub
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
