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

          <div className="command-list" aria-label="Development command">
            <div className="command-row">
              <span>01</span>
              <code>pnpm dev</code>
            </div>
          </div>

          <ResourceLinks className="resource-links" />
        </div>
      </section>
    </main>
  );
}
