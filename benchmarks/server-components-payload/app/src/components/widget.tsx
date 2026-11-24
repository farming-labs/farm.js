"use client";
import { useEffect, useState } from "react";

// An effect keeps a client component's strategy at `load`: it hydrates with the page.
export function Widget({ title, values }: { title: string; values: number[] }) {
  const [live, setLive] = useState(false);
  const [clicks, setClicks] = useState(0);
  useEffect(() => setLive(true), []);
  return (
    <section data-widget>
      <h3>{title}</h3>
      <ol>
        {values.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ol>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        {live ? `Live ${clicks}` : "Static"}
      </button>
    </section>
  );
}
