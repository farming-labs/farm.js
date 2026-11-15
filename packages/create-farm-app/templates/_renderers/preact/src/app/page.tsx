"use client";

import { useState } from "preact/hooks";
import { ResourceLinks } from "../components/resource-links";
import { apiClient } from "../lib/api";

export default function HomePage() {
  const [message, setMessage] = useState("Call a typed server function");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const callServer = async () => {
    setPending(true);
    setFailed(false);
    try {
      const result = await apiClient.greeting.post({
        body: { name: "Preact" },
      });
      if (result.error) throw result.error;
      if (!result.data) throw new Error("The server returned no greeting");
      setMessage(result.data.message);
    } catch {
      setFailed(true);
      setMessage("Try the server call again");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="landing-main">
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow-row">
            <span>00</span>
            <span>FARMJS / Preact starter</span>
          </div>

          <h1>
            Edit <code>page.tsx</code> to begin.
          </h1>

          <p className="hero-summary">
            Pages render on the server, so browsers, search engines and AI agents get complete HTML
            before any JavaScript runs.
          </p>

          <div className="command-list" aria-label="Getting started">
            <div className="command-row">
              <span>01</span>
              <code>pnpm dev</code>
            </div>
            <div className="command-row">
              <span>02</span>
              <button
                type="button"
                className={`server-call${failed ? " server-call-error" : ""}`}
                onClick={callServer}
                disabled={pending}
              >
                {pending ? "Calling…" : message}
              </button>
            </div>
          </div>

          <ul className="feature-list" aria-label="What this starter includes">
            <li>
              <span>03</span>
              <p>
                <strong>Routes.</strong> Add a folder with a page under src/app and it becomes a
                URL, with its layout, loading and error states beside it.
              </p>
            </li>
            <li>
              <span>04</span>
              <p>
                <strong>Agent-ready.</strong> Every page also answers as Markdown at its URL plus
                .md, is listed in /llms.txt, and carries JSON-LD and Open Graph from your metadata.
              </p>
            </li>
            <li>
              <span>05</span>
              <p>
                <strong>Server functions.</strong> src/app/api/greeting/route.ts runs only on the
                server. The button above calls it through a typed client, so a change to its input
                or output shows up as a type error here.
              </p>
            </li>
          </ul>

          <ResourceLinks className="resource-links" />
        </div>
      </section>
    </main>
  );
}
