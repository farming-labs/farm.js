"use client";

import { useAgent } from "agents/react";
import { useState } from "react";
import type { CounterAgent, CounterState } from "../../agent";

export default function Page() {
  const agent = useAgent<CounterAgent, CounterState>({
    agent: "CounterAgent",
    name: "shared-demo",
  });
  const [pending, setPending] = useState<"increment" | "decrement" | "reset" | null>(null);
  const connected = agent.readyState === 1 && agent.identified;
  const count = agent.state?.count ?? 0;

  async function run(action: "increment" | "decrement" | "reset") {
    setPending(action);
    try {
      await agent.stub[action]();
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="product">Farm + Cloudflare</span>
          <h1>Persistent counter agent</h1>
        </div>
        <span className={`status ${connected ? "status-online" : "status-connecting"}`}>
          <span aria-hidden="true" />
          {connected ? "Connected" : "Connecting"}
        </span>
      </header>

      <section className="workspace" aria-live="polite">
        <div className="counter" aria-label={`Current count: ${count}`}>
          <span className="counter-label">Shared state</span>
          <strong>{count}</strong>
          <p>Stored in a Durable Object and synchronized to every connected client.</p>
        </div>

        <div className="controls">
          <button
            type="button"
            className="icon-button"
            onClick={() => run("decrement")}
            disabled={!connected || pending !== null}
            aria-label="Decrease count"
            title="Decrease count"
          >
            &minus;
          </button>
          <button
            type="button"
            className="reset-button"
            onClick={() => run("reset")}
            disabled={!connected || pending !== null}
          >
            {pending === "reset" ? "Resetting" : "Reset"}
          </button>
          <button
            type="button"
            className="icon-button icon-button-primary"
            onClick={() => run("increment")}
            disabled={!connected || pending !== null}
            aria-label="Increase count"
            title="Increase count"
          >
            +
          </button>
        </div>

        {agent.connectionError ? (
          <p className="error">{agent.connectionError.message}</p>
        ) : null}
      </section>

      <footer>
        <span>CounterAgent</span>
        <code>/agents/counter-agent/shared-demo</code>
      </footer>
    </main>
  );
}
