import type { PageProps } from "@farmjs/core";
import { DocsArticle } from "../../../components/docs/article";
import { docSections, findDocPage } from "../../../lib/docs";

export const metadata = {
  title: "Docs - Farm.js",
  description: "Farm.js framework documentation.",
};

function getHref(params: PageProps["params"]) {
  const slug = params?.slug;
  const value = Array.isArray(slug) ? slug.join("/") : slug;
  return `/docs/${value || ""}`.replace(/\/$/, "");
}

export default function DocsDynamicPage({ params }: PageProps) {
  const page = findDocPage(getHref(params));

  if (!page) {
    return (
      <div className="space-y-8">
        <header className="border-b border-slate-200 pb-8">
          <p className="text-xs font-semibold uppercase text-emerald-600">Documentation</p>
          <h1 className="mt-3 font-sans text-4xl font-semibold text-slate-950">Page not found</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
            This docs page does not exist yet. Start from one of the sections below.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {docSections.map((section) => (
            <section
              key={section.title}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <h2 className="font-sans text-lg font-semibold text-slate-950">{section.title}</h2>
              <div className="mt-3 grid gap-2">
                {section.pages.map((docPage) => (
                  <a
                    key={docPage.href}
                    href={docPage.href}
                    className="text-sm text-slate-600 hover:text-slate-950"
                  >
                    {docPage.title}
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  return <DocsArticle page={page} />;
}
