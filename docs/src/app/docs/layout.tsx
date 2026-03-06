import type { LayoutProps } from "@farmjs/core";
import { Link } from "@farmjs/core";

const docLinks = [
  { href: "/docs", label: "Introduction" },
  { href: "/docs/getting-started", label: "Getting Started" },
  { href: "/docs/routing", label: "Routing" },
  { href: "/docs/layouts", label: "Layouts" },
  { href: "/docs/plugins", label: "Plugin Ecosystem" },
  { href: "/docs/plugins/create-plugin", label: "Create a Plugin" },
] as const;

export default function DocsLayout({ children }: LayoutProps) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex gap-12">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-24 space-y-1">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Documentation
            </p>
            {docLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <article className="min-w-0 flex-1">
          <div className="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-emerald-600 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none">
            {children}
          </div>
        </article>
      </div>
    </div>
  );
}
