"use client";

import { HomeClient } from "./home-client";

const snippet = `await api.jobs.importCsv.trigger({
  body: {
    fileId: "file_123",
  },
});

await api.jobs.importCsv.batchTrigger({
  body: {
    items: [
      { fileId: "file_123" },
      { fileId: "file_124" },
    ],
  },
});

await api.jobs.importCsv.status({
  query: { handleId: "evt_..." },
});`;

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <span className="eyebrow">Inngest Runtime</span>
        <h1>Farm jobs routed into Inngest.</h1>
        <p>
          This example shows the event-oriented runtime shape. The app-facing Farm API stays
          the same, but the runtime block switches to <code>runtime: inngest({"{"} ... {"}"})</code>.
        </p>
        <ul className="meta-list">
          <li>
            The demo task id is <code>import-csv</code>.
          </li>
          <li>
            Triggering returns an event handle, and status resolves from that handle.
          </li>
          <li>
            Inngest can fan out batches cleanly, but Trigger-only launch options are rejected.
          </li>
          <li>
            The same <code>schedule(...)</code> method exists, but this runtime reports scheduling
            as unsupported until the adapter grows delayed event support.
          </li>
        </ul>
        <pre>{snippet}</pre>
      </section>

      <HomeClient />
    </main>
  );
}
