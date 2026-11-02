import type { PageProps } from "@farm.js/core";
import { Link } from "@farm.js/core/client";

const pages: Record<string, { title: string; body: string }> = {
  guide: { title: "Guide", body: "Start here: tabs, stacks, and modals." },
  "guide/tabs": { title: "Tabs", body: "Each tab keeps its own stack of screens." },
  "guide/tabs/stacks": { title: "Stacks", body: "Pushes go on the current tab's stack." },
};

export default function DocsPage({ params }: PageProps) {
  const raw = params?.slug as string | string[] | undefined;
  const slug = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
  const page = pages[slug];
  return (
    <>
      <h1 className="page-title" data-testid="docs-title">
        {page?.title ?? "Not in the docs"}
      </h1>
      <p className="meta">/docs/{slug}</p>
      <p>{page?.body ?? "Any path under /docs matches the catch-all route."}</p>
      <div className="actions">
        <Link className="button secondary" href="/docs/guide/tabs/stacks">
          Deeper
        </Link>
        <Link className="button secondary" href="/docs/anything/at/all">
          Unknown page
        </Link>
      </div>
    </>
  );
}
