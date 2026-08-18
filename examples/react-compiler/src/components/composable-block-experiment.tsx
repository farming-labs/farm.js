"use client";

import { useState } from "react";

interface Item {
  id: string;
  label: string;
}

let composableOwnerExecutions = 0;
let summaryExecutions = 0;

function ComposableSummary({ count }: { count: number }) {
  "use no compiler";

  const [pinned, setPinned] = useState(false);
  const execution = typeof window === "undefined" ? 1 : ++summaryExecutions;
  return (
    <div className="composable-summary" data-summary-executions={execution}>
      <span>
        Child value <strong data-composable-count>{count}</strong>
      </span>
      <button
        data-action="composable-pin"
        type="button"
        onClick={() => setPinned((value) => !value)}
      >
        {pinned ? "Pinned" : "Pin child state"}
      </button>
    </div>
  );
}

const initialPrimary: Item[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
];
const initialSecondary: Item[] = [{ id: "c", label: "Gamma" }];

export function ComposableBlockExperiment() {
  const [visible, setVisible] = useState(true);
  const [count, setCount] = useState(0);
  const [primary, setPrimary] = useState(initialPrimary);
  const [secondary, setSecondary] = useState(initialSecondary);
  const [details, setDetails] = useState(false);

  function updateNestedBlocks() {
    setCount((value) => value + 1);
    setPrimary((items) => [...items].reverse());
    setSecondary((items) => [
      ...items,
      { id: `secondary-${items.length}`, label: `Item ${items.length + 1}` },
    ]);
  }

  return (
    <section className="heavy-benchmark" data-experiment="composable-blocks">
      <header className="heavy-heading">
        <div>
          <span className="experiment-number">08</span>
          <div>
            <p className="heavy-kicker">COMPOSABLE REACTIVE BLOCKS</p>
            <h2>Nested blocks share one safe update graph</h2>
          </div>
        </div>
        <span className="node-badge">ONE OWNER / SIX BLOCKS</span>
      </header>

      <p className="heavy-copy">
        Lists, conditions, static siblings, and a React component island can now share one compiled
        tree. Hiding the outer branch removes every inner subscription; showing it again reads the
        latest state.
      </p>

      <dl className="heavy-metrics" aria-live="polite">
        <div>
          <dt>Owner executions</dt>
          <dd data-metric="composable-owner-executions">
            {typeof window === "undefined" ? 1 : ++composableOwnerExecutions}
          </dd>
        </div>
        <div>
          <dt>Outer branch</dt>
          <dd data-metric="composable-visible">{visible ? "shown" : "hidden"}</dd>
        </div>
        <div>
          <dt>Primary rows</dt>
          <dd data-metric="composable-primary-count">{primary.length}</dd>
        </div>
        <div>
          <dt>Secondary rows</dt>
          <dd data-metric="composable-secondary-count">{secondary.length}</dd>
        </div>
      </dl>

      <div className="heavy-controls composable-controls">
        <button data-action="composable-update" type="button" onClick={updateNestedBlocks}>
          Update inner blocks <span aria-hidden="true">↗</span>
        </button>
        <button
          data-action="composable-details"
          type="button"
          onClick={() => setDetails((value) => !value)}
        >
          Toggle nested condition
        </button>
        <button
          data-action="composable-hide-update"
          type="button"
          onClick={() => {
            setVisible(false);
            updateNestedBlocks();
          }}
        >
          Hide and update
        </button>
        <button data-action="composable-hidden-update" type="button" onClick={updateNestedBlocks}>
          Update while hidden
        </button>
        <button data-action="composable-show" type="button" onClick={() => setVisible(true)}>
          Show outer block
        </button>
      </div>

      <p className="composable-static" data-composable-static>
        Static sibling outside the conditional
      </p>

      {visible && (
        <article className="composable-stage" data-composable-outer>
          <ComposableSummary count={count} />
          <div className="composable-row-set">
            <span className="composable-fixed">Fixed sibling</span>
            {primary.map((item) => (
              <span data-composable-primary={item.id} key={item.id}>
                {item.label}
              </span>
            ))}
            <i aria-hidden="true" />
            {secondary.map((item) => (
              <span data-composable-secondary={item.id} key={item.id}>
                {item.label}
              </span>
            ))}
            {details ? (
              <strong data-composable-details>Nested value {count}</strong>
            ) : (
              <span data-composable-details>Details hidden</span>
            )}
            {details && <em data-composable-ready>Nested host block ready</em>}
          </div>
        </article>
      )}
    </section>
  );
}
