"use client";

import { useState } from "react";
import { track } from "../lib/analytics";

interface ReceivedEvent {
  event: string;
  properties: { plan?: string; source?: string };
  receivedAt: string;
}

export function AnalyticsDemo() {
  const [received, setReceived] = useState<ReceivedEvent | null>(null);
  const [status, setStatus] = useState("Ready");

  async function sendEvent() {
    setStatus("Forwarding from the main thread to the worker");
    track("project_created", { plan: "pro", source: "dashboard" });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const response = await fetch("/api/analytics", { cache: "no-store" });
      const data = (await response.json()) as { events: ReceivedEvent[] };
      if (data.events[0]) {
        setReceived(data.events[0]);
        setStatus("Received from the Partytown worker");
        return;
      }
    }
    setStatus("Still waiting. Check the browser console for Partytown diagnostics.");
  }

  return (
    <section className="card">
      <div className="eyebrow"><span /> @farm.js/partytown</div>
      <h1>Keep analytics off the main thread.</h1>
      <p className="lede">
        This button calls a typed function. Partytown forwards it to an analytics SDK running in a
        web worker, and the SDK posts the event back to this app.
      </p>

      <button type="button" onClick={sendEvent}>Track project creation</button>

      <div className="result" aria-live="polite">
        <span className="status">{status}</span>
        {received ? (
          <dl>
            <div><dt>Event</dt><dd>{received.event}</dd></div>
            <div><dt>Plan</dt><dd>{received.properties.plan}</dd></div>
            <div><dt>Source</dt><dd>{received.properties.source}</dd></div>
          </dl>
        ) : (
          <code>demoAnalytics.track(...)</code>
        )}
      </div>
    </section>
  );
}
