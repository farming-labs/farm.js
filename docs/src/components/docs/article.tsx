import {
  docSections,
  getDocNeighbors,
  type DocBlock,
  type DocCallout,
  type DocPage,
} from "../../lib/docs";

function sectionId(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toneClasses(tone: DocCallout["tone"] = "note") {
  if (tone === "tip") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  if (tone === "warn") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  return "border-slate-200 bg-slate-50 text-slate-800";
}

function CodeBlock({ block }: { block: NonNullable<DocBlock["code"]> }) {
  return (
    <figure className="mt-5 max-w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
      {block.title ? (
        <figcaption className="flex min-h-10 items-center justify-between border-b border-white/10 px-4 text-xs font-medium uppercase text-slate-400">
          <span>{block.title}</span>
          {block.language ? <span>{block.language}</span> : null}
        </figcaption>
      ) : null}
      <pre className="overflow-x-auto p-4 text-sm leading-6 text-slate-100">
        <code>{block.source}</code>
      </pre>
    </figure>
  );
}

function Cards({ cards }: { cards: NonNullable<DocBlock["cards"]> }) {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {cards.map((card) => {
        const content = (
          <>
            <h3 className="font-sans text-base font-semibold text-slate-950">{card.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{card.body}</p>
          </>
        );

        if (card.href) {
          return (
            <a
              key={card.title}
              href={card.href}
              className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
            >
              {content}
            </a>
          );
        }

        return (
          <div
            key={card.title}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function Table({ table }: { table: NonNullable<DocBlock["table"]> }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            {table.headers.map((header) => (
              <th key={header} className="px-4 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocSection({ block }: { block: DocBlock }) {
  return (
    <section id={sectionId(block.title)} className="scroll-mt-24 border-t border-slate-200 pt-8">
      <h2 className="font-sans text-2xl font-semibold text-slate-950">{block.title}</h2>
      {block.body?.map((paragraph) => (
        <p key={paragraph} className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
          {paragraph}
        </p>
      ))}
      {block.bullets ? (
        <ul className="mt-4 grid gap-2 text-sm leading-6 text-slate-700">
          {block.bullets.map((bullet) => (
            <li key={bullet} className="flex gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {block.steps ? (
        <ol className="mt-4 grid gap-3 text-sm leading-6 text-slate-700">
          {block.steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {block.table ? <Table table={block.table} /> : null}
      {block.cards ? <Cards cards={block.cards} /> : null}
      {block.callout ? (
        <div
          className={`mt-5 rounded-lg border p-4 text-sm leading-6 ${toneClasses(block.callout.tone)}`}
        >
          <p className="font-semibold">{block.callout.title}</p>
          <p className="mt-1">{block.callout.body}</p>
        </div>
      ) : null}
      {block.code ? <CodeBlock block={block.code} /> : null}
    </section>
  );
}

export function DocsArticle({ page }: { page: DocPage }) {
  const { previous, next } = getDocNeighbors(page.href);

  return (
    <div className="space-y-10">
      <header className="border-b border-slate-200 pb-8">
        <p className="text-xs font-semibold uppercase text-emerald-600">
          {page.eyebrow || page.section}
        </p>
        <h1 className="mt-3 max-w-4xl font-sans text-4xl font-semibold text-slate-950 sm:text-5xl">
          {page.title}
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">{page.description}</p>
      </header>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-8">
          {page.blocks.map((block) => (
            <DocSection key={block.title} block={block} />
          ))}
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-24 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-500">On This Page</p>
            <nav className="mt-3 space-y-2">
              {page.blocks.map((block) => (
                <a
                  key={block.title}
                  href={`#${sectionId(block.title)}`}
                  className="block text-sm leading-5 text-slate-600 hover:text-slate-950"
                >
                  {block.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>
      </div>

      <nav className="grid gap-3 border-t border-slate-200 pt-6 sm:grid-cols-2">
        {previous ? (
          <a
            href={previous.href}
            className="rounded-lg border border-slate-200 bg-white p-4 text-sm transition hover:border-emerald-300 hover:shadow-sm"
          >
            <span className="block text-xs uppercase text-slate-500">Previous</span>
            <span className="mt-1 block font-semibold text-slate-950">{previous.title}</span>
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a
            href={next.href}
            className="rounded-lg border border-slate-200 bg-white p-4 text-right text-sm transition hover:border-emerald-300 hover:shadow-sm"
          >
            <span className="block text-xs uppercase text-slate-500">Next</span>
            <span className="mt-1 block font-semibold text-slate-950">{next.title}</span>
          </a>
        ) : null}
      </nav>
    </div>
  );
}

export function DocsOverview() {
  return (
    <div className="space-y-10">
      <header className="border-b border-slate-200 pb-8">
        <p className="text-xs font-semibold uppercase text-emerald-600">Documentation</p>
        <h1 className="mt-3 max-w-4xl font-sans text-4xl font-semibold text-slate-950 sm:text-5xl">
          Build complete React products with Farm.js.
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
          The docs are organized like a framework handbook: start with the app model, then move
          through routing, data, integrations, runtime behavior, deployment, and extension points.
        </p>
      </header>

      <div className="grid gap-8">
        {docSections.map((section) => (
          <section key={section.title} className="border-t border-slate-200 pt-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-sans text-2xl font-semibold text-slate-950">{section.title}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">{section.description}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {section.pages.map((page) => (
                <a
                  key={page.href}
                  href={page.href}
                  className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
                >
                  <h3 className="font-sans text-base font-semibold text-slate-950">{page.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{page.description}</p>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
