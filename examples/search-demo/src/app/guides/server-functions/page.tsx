export const dynamic = "force-static";
export const metadata = {
  title: "Server functions",
  description: "Typed server functions with explicit authorization boundaries.",
};

export default function ServerFunctionsPage() {
  return (
    <main className="article" data-pagefind-body data-pagefind-filter="section:Guides">
      <p className="eyebrow">Guide 01</p>
      <h1>Server functions</h1>
      <p className="article-lede">
        Define the contract once, validate input at the boundary, and keep authorization in server
        middleware before the handler runs.
      </p>
      <h2 id="authorization">Authorization is explicit</h2>
      <p>
        A schema proves that input has the expected shape. It does not prove that the current user
        can read or change a resource. Server middleware should check the session, tenant, and
        permission for every client-reachable call.
      </p>
      <a className="back-link" href="/">← Back to search</a>
    </main>
  );
}
