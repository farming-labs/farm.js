"use client";

import { useEffect, useState } from "leaf";

// Rendered from a server page, each Counter is an island: it hydrates on its own, when its
// strategy says. A `client:*` attribute where it's used overrides this module's default.
export const island = "idle";

export interface CounterProps {
  name: string;
  label: string;
  /** Props cross to the browser through Farm's codec, so a Date stays a Date. */
  since: Date;
  crops: Map<string, number>;
}

export function Counter(props: CounterProps) {
  const [count, setCount] = useState(0);
  // Effects run once the island has hydrated; the e2e tests wait for this attribute.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const since = props.since instanceof Date ? props.since.toISOString().slice(0, 10) : "not a Date";
  const crops = props.crops instanceof Map ? `${props.crops.size} crops` : "not a Map";
  return (
    <div
      className="island"
      id={`island-${props.name}`}
      data-hydrated={hydrated ? "true" : undefined}
    >
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        {props.label}: {count}
      </button>
      {/* What the browser got for the props, once the island runs there. */}
      <p className="props">{hydrated ? `${since}, ${crops}` : "server"}</p>
    </div>
  );
}
