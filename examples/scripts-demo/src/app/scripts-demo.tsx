"use client";

import { useSyncExternalStore, useState } from "react";
import { grantScriptConsent } from "@farm.js/scripts/client";
import { analytics, supportChat, type RecordedEvent } from "../lib/scripts";

function useScriptStatus(handle: typeof analytics | typeof supportChat) {
  return useSyncExternalStore(
    (onChange) => handle.subscribe(onChange),
    () => handle.status,
    () => "idle" as const,
  );
}

export function ScriptsDemo() {
  const analyticsStatus = useScriptStatus(analytics);
  const chatStatus = useScriptStatus(supportChat);
  const [event, setEvent] = useState<RecordedEvent | null>(null);
  const [chatMessage, setChatMessage] = useState("Not requested");

  async function allowAndTrack() {
    grantScriptConsent("analytics");
    const recorded = await analytics.use((client) =>
      client.track("project_created", { plan: "pro", source: "dashboard" }),
    );
    setEvent(recorded);
  }

  async function openSupport() {
    setChatMessage("Loading on demand");
    const message = await supportChat.use((chat) => {
      chat.load({ visitor: "Ada" });
      return chat.open();
    });
    setChatMessage(message);
  }

  return (
    <section className="demo">
      <header>
        <span className="eyebrow">@farm.js/scripts</span>
        <h1>Load third parties on your terms.</h1>
        <p>
          Typed browser SDKs, explicit timing, consent gates, shared readiness, and no ambient
          <code> window.vendor</code> calls in application components.
        </p>
      </header>

      <div className="grid">
        <article>
          <div className="card-heading">
            <span>Analytics</span>
            <output data-status={analyticsStatus}>{analyticsStatus}</output>
          </div>
          <h2>Wait for consent</h2>
          <p>The SDK is not requested until this app grants its analytics category.</p>
          <button type="button" onClick={allowAndTrack}>
            Allow and track event
          </button>
          <pre>{event ? JSON.stringify(event, null, 2) : "No event recorded"}</pre>
        </article>

        <article>
          <div className="card-heading">
            <span>Support chat</span>
            <output data-status={chatStatus}>{chatStatus}</output>
          </div>
          <h2>Load only when asked</h2>
          <p>The support SDK costs nothing until a visitor actually opens it.</p>
          <button type="button" onClick={openSupport}>
            Open support
          </button>
          <pre>{chatMessage}</pre>
        </article>
      </div>
    </section>
  );
}
