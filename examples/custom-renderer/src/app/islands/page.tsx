import type { Metadata } from "@farm.js/core";
import { Counter } from "../../components/counter";

export const metadata: Metadata = { title: "Islands" };

// No "use client": the page ships HTML, and each Counter in it hydrates as its own island
// (`experimental.isolatedClientHydration` in farm.config.ts). The layout's root keeps the page as
// server HTML, so the islands keep working under a layout that hydrates.
export default function IslandsPage() {
  const since = new Date("2026-03-01T00:00:00.000Z");
  const crops = new Map([
    ["wheat", 3],
    ["barley", 5],
  ]);
  return (
    <section>
      <h1>Islands</h1>
      <p id="islands-static">This text ships no JavaScript.</p>
      <Counter name="load" label="Starts at once" since={since} crops={crops} client:load />
      <Counter name="idle" label="Starts when the browser is idle" since={since} crops={crops} />
      {/* Below the fold, so it waits until the page scrolls to it. */}
      <div style={{ marginTop: "150vh" }}>
        <Counter
          name="visible"
          label="Starts when scrolled to"
          since={since}
          crops={crops}
          client:visible
        />
      </div>
    </section>
  );
}
