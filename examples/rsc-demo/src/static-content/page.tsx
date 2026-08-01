import { Counter } from "../components/Counter";

export const metadata = {
  title: "Automatic Optimized Boundaries | Farm.js RSC Demo",
  description: "Flag-only optimization of eligible host-content boundaries",
};

interface PageProps {
  searchParams?: Record<string, string>;
}

const concepts = [
  "streaming",
  "serialization",
  "caching",
  "composition",
  "reconciliation",
  "invalidation",
] as const;

function StaticContentDocument({ sectionCount }: { sectionCount: number }) {
  return (
    <article
      className="static-content space-y-8 rounded-xl border border-emerald-700/60 bg-slate-900/40 p-6"
      data-static-content="automatic"
    >
      <header>
        <h1>Representation-aware static content</h1>
        <p>
          This ordinary JSX is automatically rendered through one optimized boundary when Farm can
          prove the evaluated tree contains only supported host content.
        </p>
        <p>
          Escaping check: {`<script>globalThis.__strataInjected = true</script> & "quotes".`}
        </p>
        <a
          href="https://github.com/farming-labs/strata"
          rel="noopener noreferrer"
          target="_blank"
        >
          Read the Strata source
        </a>
      </header>

      {Array.from({ length: sectionCount }, (_, index) => {
        const concept = concepts[index % concepts.length];
        const number = index + 1;

        return (
          <section
            key={concept + number}
            className="space-y-3 border-b border-slate-700/70 pb-8"
            data-section={number}
          >
            <h2>
              {number}. {concept} without React-owned interior nodes
            </h2>
            <p>
              This host-only section keeps {concept} content inside an automatically selected
              boundary. <strong>React still owns the surrounding application</strong>, including
              the interactive counter beside this document.
            </p>
            <p>
              The server sends sanitized HTML through Flight instead of serializing every{" "}
              <code>{`<section_${number}>`}</code> host element as an independently reconcilable
              React record.
            </p>
            <pre data-language="typescript">
              <code>{`export const section_${number} = {
  representation: "static-fragment",
  concept: "${concept}",
  reactOwnedInterior: false
}`}</code>
            </pre>
            <ul>
              <li>Measure {concept} server work.</li>
              <li>Compare Flight payload bytes.</li>
              <li>Preserve client state outside the boundary.</li>
            </ul>
          </section>
        );
      })}

      <footer>
        <p>
          Client Components, event handlers, effects, refs, Suspense slots, and independently
          updating state remain outside automatically optimized interiors.
        </p>
      </footer>
    </article>
  );
}

export default function StaticContentPage({ searchParams = {} }: PageProps) {
  const view = searchParams.view === "details" ? "details" : "summary";
  const sectionCount = view === "details" ? 36 : 24;

  return (
    <div className="space-y-8">
      <div className="space-y-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">
          Experimental
        </p>
        <h1 className="text-4xl font-bold text-white">Automatic optimized boundaries</h1>
        <p className="mx-auto max-w-3xl text-slate-400">
          The application uses ordinary JSX. Enabling experimental.optimizedBoundary lets Farm
          select eligible host-only regions and fall back to React for everything else.
        </p>
        <div className="flex justify-center gap-3">
          <a
            href="/static-content?view=summary"
            data-view-link="summary"
            className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold hover:bg-emerald-500"
          >
            Summary content
          </a>
          <a
            href="/static-content?view=details"
            data-view-link="details"
            className="rounded-lg bg-slate-600 px-4 py-2 font-semibold hover:bg-slate-500"
          >
            Detailed content
          </a>
        </div>
        <p className="font-mono text-sm text-cyan-300" data-render-mode="automatic">
          Current representation: automatic · {sectionCount} host-only sections
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <StaticContentDocument sectionCount={sectionCount} />

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Counter />
          <p className="mt-4 text-sm text-slate-400">
            Change the count, then switch content views. The Client Component retains its state
            while Farm replaces the optimized server-owned boundary.
          </p>
        </aside>
      </div>
    </div>
  );
}
