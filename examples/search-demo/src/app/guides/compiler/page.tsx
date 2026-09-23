export const dynamic = "force-static";
export const metadata = {
  title: "React compiler",
  description: "Direct DOM updates for components that Farm can prove safe.",
};

export default function CompilerPage() {
  return (
    <main className="article" data-pagefind-body data-pagefind-filter="section:Guides">
      <p className="eyebrow">Guide 03</p>
      <h1>React compiler</h1>
      <p className="article-lede">
        Proven components can turn state changes into direct DOM updates while unsupported cases
        retain the normal React rendering path.
      </p>
      <h2 id="safe-fallback">Optimization needs a safe fallback</h2>
      <p>
        The compiler verifies ownership before patching. Refs, effects, and ambiguous expressions
        fall back instead of changing application behavior for a benchmark result.
      </p>
      <a className="back-link" href="/">← Back to search</a>
    </main>
  );
}
