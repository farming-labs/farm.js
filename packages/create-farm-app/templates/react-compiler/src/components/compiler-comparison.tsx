"use client";

import { useState } from "react";

let compiledExecutions = 0;
let reactExecutions = 0;

export function CompiledCounter() {
  const [count, setCount] = useState(0);

  return (
    <article className="counter-path counter-path-compiled" data-path="compiled">
      <div className="counter-heading">
        <span className="path-index">A</span>
        <div>
          <h3>AOT compiled</h3>
          <p>Direct DOM binding</p>
        </div>
      </div>

      <dl className="counter-metrics" aria-live="polite">
        <div>
          <dt>State</dt>
          <dd data-metric="state">{count}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++compiledExecutions}
          </dd>
        </div>
      </dl>

      <button type="button" data-action="update" onClick={() => setCount((value) => value + 1)}>
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
    <article className="counter-path" data-path="react">
      <div className="counter-heading">
        <span className="path-index">B</span>
        <div>
          <h3>Base React</h3>
          <p>React reconciliation</p>
        </div>
      </div>

      <dl className="counter-metrics" aria-live="polite">
        <div>
          <dt>State</dt>
          <dd data-metric="state">{count}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">{typeof window === "undefined" ? 1 : ++reactExecutions}</dd>
        </div>
      </dl>

      <button type="button" data-action="update" onClick={() => setCount((value) => value + 1)}>
        Update React state
        <span aria-hidden="true">↗</span>
      </button>
    </article>
  );
}

export function CompilerComparison() {
  return (
    <section className="compiler-check" aria-labelledby="compiler-check-title">
      <header className="check-heading">
        <div>
          <span>Live check</span>
          <h2 id="compiler-check-title">Same click. Less React work.</h2>
        </div>
        <p>Watch executions after each update.</p>
      </header>

      <div className="comparison-grid">
        <CompiledCounter />
        <BaseReactCounter />
      </div>
    </section>
  );
}
