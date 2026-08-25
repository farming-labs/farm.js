import { Counter } from "../components/counter";
import { Guestbook } from "../components/guestbook";
import { ResourceLinks } from "../components/resource-links";

// This page renders on the server. The "use client" components below are
// hydrated as islands, and the rest of the page ships no JavaScript.
export default function HomePage() {
  const renderedAt = new Date().toLocaleTimeString("en-US", { hour12: false });

  return (
    <main className="landing-main">
      <section className="hero-section playground-hero">
        <div className="hero-copy playground-copy">
          <div className="eyebrow-row">
            <span>00</span>
            <span>FARMJS / Playground</span>
          </div>

          <h1>
            The framework, running in <code>your browser</code>.
          </h1>

          <p className="playground-lede">
            A product-integrated full-stack framework on Vite: typesafe APIs
            and server functions, integrations as typed modules, and an
            experimental compiler that turns component updates into direct DOM
            patches. This page rendered on the server at{" "}
            <code>{renderedAt}</code>. Edit <code>src/app/page.tsx</code> and
            watch it hot-reload.
          </p>

          <div className="demo-list">
            <section className="demo-block" aria-label="Compiled client island">
              <div className="demo-heading">
                <span>01</span>
                <span>Compiled client island</span>
              </div>
              <p className="demo-note">
                This counter opts into the experimental AOT compiler with a{" "}
                <code>"use compiler"</code> directive (see{" "}
                <code>src/components/counter.tsx</code>): its state updates
                patch the DOM directly, skipping the reconciler. The guestbook
                below stays on the normal React path.
              </p>
              <Counter />
            </section>

            <section
              className="demo-block"
              aria-label="Server function guestbook"
            >
              <div className="demo-heading">
                <span>02</span>
                <span>Server function guestbook</span>
              </div>
              <p className="demo-note">
                The form calls a <code>createServerFn</code> mutation through a
                typed API client, validated with Zod on the server.
              </p>
              <Guestbook />
            </section>
          </div>

          <ResourceLinks
            className="resource-links"
            primary={{
              href: "https://github.com/farming-labs/farm.js",
              label: "Star on GitHub",
            }}
          />
        </div>
      </section>
    </main>
  );
}
