"use client";

import { useState } from "react";

let primitivePropExecutions = 0;

interface PrimitivePropPanelProps {
  active: boolean;
  label: string;
  step: number;
}

export function PrimitivePropPanel({ active, label, step }: PrimitivePropPanelProps) {
  const [count, setCount] = useState(0);

  return (
    <article
      className={active ? "edge-card edge-card--active" : "edge-card"}
      data-active={active}
      data-experiment="primitive-props"
    >
      <header>
        <span className="experiment-number">PROP</span>
        <div>
          <h3>{label}</h3>
          <p>Flat primitive props share the prepared state dependency graph.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Local count</dt>
          <dd data-metric="count">{count}</dd>
        </div>
        <div>
          <dt>Current step</dt>
          <dd data-metric="step">{step}</dd>
        </div>
        <div>
          <dt>Render plans</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++primitivePropExecutions}
          </dd>
        </div>
      </dl>
      <div className="binding-preview" data-slot="status">
        {active ? <strong>{label} is active</strong> : <span>{label} is idle</span>}
      </div>
      <button
        data-action="local-prop-step"
        onClick={() => setCount((value) => value + step)}
        type="button"
      >
        Apply current step
      </button>
    </article>
  );
}

export function PrimitivePropExperiment() {
  "use no compiler";

  const [version, setVersion] = useState(0);
  const active = version % 2 === 1;
  const label = active ? "Compiled props B" : "Compiled props A";
  const step = active ? 5 : 1;

  return (
    <section className="edge-lab" aria-labelledby="primitive-props-title">
      <div className="section-heading">
        <span>PRIMITIVE PROP REACTIVITY</span>
        <h2 id="primitive-props-title">Parent data, without rebuilding the compiled plan.</h2>
        <p>
          Change the string, number, and boolean props together. The mounted host tree and local
          state remain in place; objects, functions, symbols, and children still use React.
        </p>
      </div>
      <div className="edge-grid edge-grid--paired edge-grid--single">
        <div className="primitive-prop-shell">
          <div className="primitive-prop-toolbar">
            <span>Parent source / version {version}</span>
            <button
              data-action="update-primitive-props"
              onClick={() => setVersion((value) => value + 1)}
              type="button"
            >
              Update parent props
            </button>
          </div>
          <PrimitivePropPanel active={active} label={label} step={step} />
        </div>
      </div>
    </section>
  );
}
