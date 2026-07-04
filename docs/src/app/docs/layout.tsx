import type { LayoutProps } from "@farmjs/core";
import { docSections } from "../../lib/docs";

export default function DocsLayout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="font-sans text-sm font-semibold text-slate-950">
            Farm.js
          </a>
          <nav className="flex items-center gap-4 text-sm text-slate-600">
            <a href="/docs" className="hover:text-slate-950">
              Docs
            </a>
            <a href="/docs/examples" className="hover:text-slate-950">
              Examples
            </a>
            <a href="/docs/reference" className="hover:text-slate-950">
              Reference
            </a>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:px-8">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
            <a
              href="/docs"
              className="mb-5 block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-950 hover:border-emerald-300"
            >
              Documentation
            </a>
            <div className="space-y-6">
              {docSections.map((section) => (
                <div key={section.title}>
                  <p className="px-3 text-xs font-semibold uppercase text-slate-500">
                    {section.title}
                  </p>
                  <div className="mt-2 space-y-1">
                    {section.pages.map((page) => (
                      <a
                        key={page.href}
                        href={page.href}
                        className="block rounded-md px-3 py-1.5 text-sm leading-5 text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                      >
                        {page.title}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>
        </aside>

        <main className="min-w-0 pb-16">{children}</main>
      </div>
    </div>
  );
}
