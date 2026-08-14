"use client";

import { useState } from "react";

let compiledExecutions = 0;
let reactExecutions = 0;

export function CompiledCounter() {
  const [count, setCount] = useState(0);

  return (
    <article
      className="counter-card counter-card--compiled"
      data-path="compiled"
    >
      <header className="card-heading">
        <div>
          <span className="card-index">A</span>
          <h2>AOT compiled</h2>
        </div>
        <span className="path-badge">DIRECT BINDINGS</span>
      </header>

      <div className="metrics" aria-live="polite">
        <div className="metric">
          <span>State value</span>
          <strong data-metric="state">{count}</strong>
        </div>
        <div className="metric">
          <span>Component executions</span>
          <strong data-metric="executions">
            {typeof window === "undefined" ? 1 : ++compiledExecutions}
          </strong>
        </div>
      </div>

      <p
        className={
          count > 0 ? "update-status update-status--active" : "update-status"
        }
      >
        {count > 0 ? "DOM bindings patched" : "Ready for an update"}
      </p>

      <button
        type="button"
        data-action="update"
        onClick={() => setCount((value) => value + 1)}
      >
        Update compiled state
        <span aria-hidden="true">↗</span>
      </button>
    </article>
  );
}

export function BaseReactCounter() {
  "use no compiler";

  const [count, setCount] = useState(0);

  return (
    <article className="counter-card" data-path="react">
      <header className="card-heading">
        <div>
          <span className="card-index">B</span>
          <h2>Base React</h2>
        </div>
        <span className="path-badge">RECONCILIATION</span>
      </header>

      <div className="metrics" aria-live="polite">
        <div className="metric">
          <span>State value</span>
          <strong data-metric="state">{count}</strong>
        </div>
        <div className="metric">
          <span>Component executions</span>
          <strong data-metric="executions">
            {typeof window === "undefined" ? 1 : ++reactExecutions}
          </strong>
        </div>
      </div>

      <p
        className={
          count > 0 ? "update-status update-status--active" : "update-status"
        }
      >
        {count > 0 ? "React tree committed" : "Ready for an update"}
      </p>

      <button
        type="button"
        data-action="update"
        onClick={() => setCount((value) => value + 1)}
      >
        Update React state
        <span aria-hidden="true">↗</span>
      </button>
    </article>
  );
}

export function CompilerComparison() {
  return (
    <section aria-labelledby="comparison-title">
      <h2 id="comparison-title" className="sr-only">
        AOT compiler and base React comparison
      </h2>

      <div className="comparison-grid">
        <CompiledCounter />
        <BaseReactCounter />
      </div>

      <div className="flow-note">
        <div>
          <span className="flow-number">01</span>
          <p>
            React still owns the initial render, placement, events, SSR, and
            hydration.
          </p>
        </div>
        <div>
          <span className="flow-number">02</span>
          <p>The compiler prepares state-to-DOM bindings during the build.</p>
        </div>
        <div>
          <span className="flow-number">03</span>
          <p>
            Eligible local updates flush those bindings without a React
            rerender.
          </p>
        </div>
      </div>
    </section>
  );
}
