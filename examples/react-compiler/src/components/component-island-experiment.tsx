"use client";

import { useState } from "react";

let ownerExecutions = 0;
let staticTreeExecutions = 0;
let islandExecutions = 0;

function StaticWorkload({ seed }: { seed: number }) {
  const execution =
    typeof window === "undefined" ? 1 : ++staticTreeExecutions;
  return (
    <div
      aria-hidden="true"
      className="workload-grid component-island-workload"
      data-static-executions={execution}
    >
      {Array.from({ length: 192 }, (_, index) => (
        <span className="workload-cell" data-cell={index + seed} key={index}>
          <i />
          <i />
          <i />
        </span>
      ))}
    </div>
  );
}

function LiveIsland({ tick }: { tick: number }) {
  "use no compiler";

  const [pinned, setPinned] = useState(false);
  const execution = typeof window === "undefined" ? 1 : ++islandExecutions;
  return (
    <div className="component-island-live" data-island-executions={execution}>
      <div>
        <span>React-owned island</span>
        <strong data-island-tick>{tick}</strong>
      </div>
      <button data-action="island-pin" type="button" onClick={() => setPinned((value) => !value)}>
        {pinned ? "Pinned" : "Pin child state"}
      </button>
    </div>
  );
}

export function ComponentIslandExperiment() {
  const [tick, setTick] = useState(0);

  return (
    <section className="heavy-benchmark" data-benchmark="component-islands" data-tick={tick}>
      <header className="heavy-heading">
        <div>
          <span className="experiment-number">06</span>
          <div>
            <p className="heavy-kicker">REACT COMPONENT ISLAND</p>
            <h2>Update one child, leave the heavy sibling alone</h2>
          </div>
        </div>
        <span className="node-badge">768 REACT-OWNED HOST NODES</span>
      </header>

      <p className="heavy-copy">
        The compiler patches the owner&apos;s prepared targets and asks React to render only the child
        whose prop changed. The static component stays mounted, and the live child keeps its Hooks,
        context, events, and local state.
      </p>

      <dl className="heavy-metrics heavy-metrics--islands" aria-live="polite">
        <div>
          <dt>Interaction</dt>
          <dd data-metric="island-tick">{tick}</dd>
        </div>
        <div>
          <dt>Owner executions</dt>
          <dd data-metric="island-owner-executions">
            {typeof window === "undefined" ? 1 : ++ownerExecutions}
          </dd>
        </div>
      </dl>

      <div className="heavy-controls">
        <button
          data-action="island-update"
          type="button"
          onClick={() => setTick((value) => value + 1)}
        >
          Update component island
          <span aria-hidden="true">↗</span>
        </button>
      </div>

      <LiveIsland tick={tick} />
      <StaticWorkload seed={7} />
    </section>
  );
}
