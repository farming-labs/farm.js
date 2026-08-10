import { ResourceLinks } from "../components/resource-links";
import { getServerSession } from "../lib/session";

export default async function HomePage() {
  const session = await getServerSession();

  return (
    <main className="landing-main">
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow-row">
            <span>00</span>
            <span>FARMJS / Better Auth starter</span>
          </div>

          <h1>
            {session ? (
              <>
                Open your <code>/dashboard</code>.
              </>
            ) : (
              <>
                Connect Postgres. Start at <code>/sign-up</code>.
              </>
            )}
          </h1>

          <div className="command-list" aria-label="Development commands">
            <div className="command-row">
              <span>01</span>
              <code>cp .env.example .env.local</code>
            </div>
            <div className="command-row">
              <span>02</span>
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
