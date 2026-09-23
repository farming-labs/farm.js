import { SearchDemo } from "./search-demo";

export const dynamic = "force-static";
export const metadata = {
  title: "Search",
  description: "Search Farm guides without running a search server.",
};

export default function Page() {
  return (
    <main data-pagefind-body data-pagefind-filter="section:Overview">
      <section className="hero">
        <p className="eyebrow">@farm.js/search</p>
        <h1>Search the generated site, not a hand-maintained list.</h1>
        <p className="lede">
          Farm indexes static HTML after prerendering, then the browser loads only the Pagefind
          chunks needed for each query.
        </p>
      </section>

      <div data-pagefind-ignore="all">
        <SearchDemo />
      </div>

      <section className="proof" aria-labelledby="proof-title">
        <p className="eyebrow">What gets indexed</p>
        <h2 id="proof-title">Real page content and metadata</h2>
        <p>
          Try authorization, nested route, direct DOM update, or static generation. Results include
          the matching guide, a readable excerpt, and its route.
        </p>
      </section>
    </main>
  );
}
