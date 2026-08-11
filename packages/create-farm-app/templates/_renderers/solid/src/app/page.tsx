"use client";

import { createSignal } from "solid-js";
import { ResourceLinks } from "../components/resource-links";
import { api } from "../lib/api-client";

export default function HomePage() {
  const [message, setMessage] = createSignal("Call a typed server function");
  const [pending, setPending] = createSignal(false);

  const callServer = async () => {
    setPending(true);
    try {
      const result = await api.greeting.post({
        body: { name: "Solid" },
      });
      if (result.error) throw result.error;
      if (!result.data) throw new Error("The server returned no greeting");
      setMessage(result.data.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <main class="landing-main">
      <section class="hero-section">
        <div class="hero-copy">
          <div class="eyebrow-row">
            <span>00</span>
            <span>FARMJS / Solid starter</span>
          </div>

          <h1>
            Edit <code>page.tsx</code> to begin.
          </h1>

          <div class="command-list" aria-label="Getting started">
            <div class="command-row">
              <span>01</span>
              <code>pnpm dev</code>
            </div>
            <div class="command-row">
              <span>02</span>
              <button type="button" class="server-call" onClick={callServer} disabled={pending()}>
                {pending() ? "Calling…" : message()}
              </button>
            </div>
          </div>

          <ResourceLinks className="resource-links" />
        </div>
      </section>
    </main>
  );
}
