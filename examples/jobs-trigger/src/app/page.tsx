"use client";

import { HomeClient } from "./home-client";

const snippet = `await api.jobs.farmjsSanityCheck.trigger({
  body: {
    ping: true,
    $options: {
      debounce: {
        key: "sanity-browser",
        delay: "15s",
      },
      tags: ["demo"],
    },
  },
});

await api.jobs.farmjsSanityCheck.schedule({
  body: {
    ping: true,
    $schedule: {
      after: "1m",
      tags: ["scheduled"],
    },
  },
});

await api.jobs.farmjsSanityCheck.batchTrigger({
  body: {
    items: [
      { ping: true, $options: { idempotencyKey: "sanity:1" } },
      { ping: true, $options: { idempotencyKey: "sanity:2" } },
    ],
  },
});

await api.jobs.farmjsSanityCheck.status({
  query: { handleId: "run_..." },
});`;

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <span className="eyebrow">Trigger Runtime</span>
        <h1>Farm jobs routed into Trigger.dev.</h1>
        <p>
          This example uses the Trigger-specific runtime block but keeps the app-facing API in
          the normal Farm shape: <code>jobs({"{"} trigger, tasks {"}"})</code>.
        </p>
        <ul className="meta-list">
          <li>
            The sample task id is <code>farmjs-sanity-check</code>.
          </li>
          <li>
            The browser demo schedules a real one-off run and then polls it by <code>handleId</code>.
          </li>
          <li>
            Trigger options like <code>debounce</code>, plus APIs like <code>schedule</code> and
            <code> batchTrigger</code>, are available for automation-heavy flows.
          </li>
          <li>
            No webhook is required for this page. It uses direct API calls plus polling.
          </li>
        </ul>
        <pre>{snippet}</pre>
      </section>

      <HomeClient />
    </main>
  );
}
