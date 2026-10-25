import { ResourceLinks } from "../components/resource-links";

export default function HomePage() {
  return (
    <main className="landing-main">
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow-row">
            <span>00</span>
            <span>FARMJS / Basic starter</span>
          </div>

          <h1>
            Edit <code>page.tsx</code> to begin.
          </h1>

          <p className="hero-summary">
            Pages render on the server, so browsers, search engines and AI agents get complete HTML
            before any JavaScript runs.
          </p>

          <div className="command-list" aria-label="Development command">
            <div className="command-row">
              <span>01</span>
              <code>pnpm dev</code>
            </div>
          </div>

          <ul className="feature-list" aria-label="What this starter includes">
            <li>
              <span>02</span>
              <p>
                <strong>Routes.</strong> Add a folder with a page under src/app and it becomes a
                URL, with its layout, loading and error states beside it.
              </p>
            </li>
            <li>
              <span>03</span>
              <p>
                <strong>Agent-ready.</strong> Every page also answers as Markdown at its URL plus
                .md, and its head carries JSON-LD and Open Graph from your metadata.
              </p>
            </li>
            <li>
              <span>04</span>
              <p>
                <strong>Docs.</strong> Write Markdown in src/app/docs for a searchable site at
                /docs, with llms.txt and an MCP server agents can query.
              </p>
            </li>
          </ul>

          <ResourceLinks className="resource-links" />
        </div>
      </section>
    </main>
  );
}
