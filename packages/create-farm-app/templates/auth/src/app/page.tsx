import { auth } from "@farm.js/auth/server";
import { ResourceLinks } from "../components/resource-links";

export default async function HomePage() {
  const session = await auth.session();

  return (
    <main className="landing-main">
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow-row">
            <span>00</span>
            <span>FARMJS / Auth starter</span>
          </div>

          <h1>
            {session ? (
              <>
                Open your <code>/dashboard</code>.
              </>
            ) : (
              <>
                Start at <code>/sign-up</code>.
              </>
            )}
          </h1>

          <div className="command-list" aria-label="Development command">
            <div className="command-row">
              <span>01</span>
              <code>pnpm dev</code>
            </div>
          </div>

          <ResourceLinks
            className="resource-links"
            primary={{
              href: session ? "/dashboard" : "/sign-up",
              label: session ? "Dashboard" : "Get started",
            }}
          />
        </div>
      </section>
    </main>
  );
}
