import { CompilerComparison } from "../components/compiler-comparison";
import { ResourceLinks } from "../components/resource-links";

export default function HomePage() {
  return (
    <main className="landing-main">
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow-row">
            <span>00</span>
            <span>FARMJS / React Compiler starter</span>
            <span className="experimental-label">Experimental</span>
          </div>

          <h1>
            Edit <code>page.tsx</code>. The compiler handles the rest.
          </h1>

          <p className="hero-summary">
            Keep writing ordinary React. FARMJS prepares direct bindings for safe local state
            updates and leaves everything else with React.
          </p>

          <div className="command-list" aria-label="Getting started">
            <div className="command-row">
              <span>01</span>
              <code>pnpm dev</code>
            </div>
            <div className="command-row">
              <span>02</span>
              <div className="compiler-status">
                <span className="status-dot" aria-hidden="true" />
                <code>experimental.compiler: true</code>
              </div>
            </div>
          </div>

          <CompilerComparison />
          <ResourceLinks className="resource-links" />
        </div>
      </section>
    </main>
  );
}
