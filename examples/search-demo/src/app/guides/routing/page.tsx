export const dynamic = "force-static";
export const metadata = {
  title: "Typed routing",
  description: "File routes, nested layouts, and generated route declarations.",
};

export default function RoutingPage() {
  return (
    <main className="article" data-pagefind-body data-pagefind-filter="section:Guides">
      <p className="eyebrow">Guide 02</p>
      <h1>Typed routing</h1>
      <p className="article-lede">
        Farm maps the app directory to typed paths and preserves nested layout ownership through
        server rendering and client navigation.
      </p>
      <h2 id="nested-routes">Nested routes keep their structure</h2>
      <p>
        Static parameters and known route paths become generated TypeScript declarations, so links
        fail during type checking instead of after a user follows them.
      </p>
      <a className="back-link" href="/">← Back to search</a>
    </main>
  );
}
