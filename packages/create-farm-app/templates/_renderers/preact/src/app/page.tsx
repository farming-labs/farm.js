"use client";

import { useState } from "preact/hooks";
import { ResourceLinks } from "../components/resource-links";
import { api } from "../lib/api-client";

export default function HomePage() {
  const [message, setMessage] = useState("Call a typed server function");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const callServer = async () => {
    setPending(true);
    setFailed(false);
    try {
      const result = await api.greeting.post({
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

          <ResourceLinks className="resource-links" />
        </div>
      </section>
    </main>
  );
}
