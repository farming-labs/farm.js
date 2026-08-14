"use client";

import { useState } from "react";

let compiledBatchExecutions = 0;
let reactBatchExecutions = 0;
let multipleBindingExecutions = 0;
let keyedListExecutions = 0;

export function CompiledBatchExperiment() {
  const [count, setCount] = useState(0);
  const [snapshot, setSnapshot] = useState(0);

  return (
    <article className="edge-card" data-experiment="batch-compiled">
      <header>
        <span className="experiment-number">02A</span>
        <div>
          <h3>Compiled batch</h3>
          <p>Two queued updates, one prepared DOM flush.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Count</dt>
          <dd data-metric="count">{count}</dd>
        </div>
        <div>
          <dt>Event snapshot</dt>
          <dd data-metric="snapshot">{snapshot}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++compiledBatchExecutions}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        data-action="batch"
        onClick={() => {
          setCount((value) => value + 1);
          setCount((value) => value + 1);
          setSnapshot(count);
        }}
      >
        Run batched update
      </button>
    </article>
  );
}

export function ReactBatchExperiment() {
  "use no compiler";

  const [count, setCount] = useState(0);
  const [snapshot, setSnapshot] = useState(0);

  return (
    <article className="edge-card" data-experiment="batch-react">
      <header>
        <span className="experiment-number">02B</span>
        <div>
          <h3>React batch</h3>
          <p>The semantic control for the same event.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Count</dt>
          <dd data-metric="count">{count}</dd>
        </div>
        <div>
          <dt>Event snapshot</dt>
          <dd data-metric="snapshot">{snapshot}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++reactBatchExecutions}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        data-action="batch"
        onClick={() => {
          setCount((value) => value + 1);
          setCount((value) => value + 1);
          setSnapshot(count);
        }}
      >
        Run React update
      </button>
    </article>
  );
}

export function MultipleBindingExperiment() {
  const [count, setCount] = useState(0);
  const [active, setActive] = useState(false);

  return (
    <article
      className={active ? "edge-card edge-card--active" : "edge-card"}
      data-count={count}
      data-experiment="multiple-bindings"
    >
      <header>
        <span className="experiment-number">03</span>
        <div>
          <h3>Two state cells</h3>
          <p>Text, class, data attribute, and input value bindings.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Count</dt>
          <dd data-metric="count">{count}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd data-metric="status">{active ? "active" : "idle"}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++multipleBindingExecutions}
          </dd>
        </div>
      </dl>
      <label className="binding-preview">
        Bound input value
        <input value={`value-${count}`} readOnly />
      </label>
      <div className="button-row">
        <button
          type="button"
          data-action="increment"
          onClick={() => setCount((value) => value + 1)}
        >
          Increment
        </button>
        <button
          type="button"
          data-action="toggle"
          onClick={() => setActive((value) => !value)}
        >
          Toggle status
        </button>
      </div>
    </article>
  );
}

export function KeyedListFallbackExperiment() {
  const [items, setItems] = useState(["item-1"]);

  return (
    <article
      className="edge-card edge-card--fallback"
      data-experiment="keyed-fallback"
    >
      <header>
        <span className="experiment-number">04</span>
        <div>
          <h3>Keyed list fallback</h3>
          <p>Dynamic structure stays under React reconciliation.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Items</dt>
          <dd data-metric="items">{items.length}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++keyedListExecutions}
          </dd>
        </div>
      </dl>
      <ul data-list="keyed">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button
        type="button"
        data-action="add-item"
        onClick={() =>
          setItems((value) => [...value, `item-${value.length + 1}`])
        }
      >
        Add keyed item
      </button>
    </article>
  );
}

export function CompilerEdgeLab() {
  return (
    <section className="edge-lab" aria-labelledby="edge-lab-title">
      <div className="section-heading">
        <span>EDGE LAB / SUPPORTED SCOPE</span>
        <h2 id="edge-lab-title">Correctness before coverage.</h2>
        <p>
          Eligible local state gets direct bindings. Dynamic tree shapes fall
          back to React instead of producing a faster but incorrect result.
        </p>
      </div>

      <div className="edge-grid edge-grid--paired">
        <CompiledBatchExperiment />
        <ReactBatchExperiment />
      </div>
      <div className="edge-grid">
        <MultipleBindingExperiment />
        <KeyedListFallbackExperiment />
      </div>

      <aside className="hook-warning">
        <span>HOOKS + KEYS</span>
        <p>
          Never call a Hook directly inside <code>items.map(...)</code>. Put the
          Hook in a separate keyed row component. This compiler rejects the
          inline pattern; the current compiler leaves the keyed list itself to
          React.
        </p>
      </aside>
    </section>
  );
}
