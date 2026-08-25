"use client";

import { useState } from "react";

interface Item {
  id: string;
  label: string;
}

const initialItems: Item[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

let recursiveOwnerExecutions = 0;

export function RecursiveHostBlockExperiment() {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(false);
  const [items, setItems] = useState(initialItems);
  const [updates, setUpdates] = useState(0);

  function updateInnerBlocks() {
    setLoading((value) => !value);
    setDetails((value) => !value);
    setItems((rows) => {
      const reversed = [...rows].reverse();
      return reversed.map((row, index) =>
        index === 0 ? { ...row, label: `${row.label} · updated` } : row,
      );
    });
    setUpdates((value) => value + 1);
  }

  return (
    <section className="heavy-benchmark" data-experiment="recursive-host-blocks">
      <header className="heavy-heading">
        <div>
          <span className="experiment-number">09</span>
          <div>
            <p className="heavy-kicker">RECURSIVE HOST BLOCKS</p>
            <h2>Nested conditions and lists update their own DOM ranges</h2>
          </div>
        </div>
        <span className="node-badge">HOST ONLY / REACT FALLBACK</span>
      </header>

      <p className="heavy-copy">
        The outer branch, its nested condition, a deeper condition, and the keyed rows share one
        build-time dependency graph. Each state change reaches the smallest safe block without
        rerunning this component.
      </p>

      <dl className="heavy-metrics" aria-live="polite">
        <div>
          <dt>Owner executions</dt>
          <dd data-metric="recursive-owner-executions">
            {typeof window === "undefined" ? 1 : ++recursiveOwnerExecutions}
          </dd>
        </div>
        <div>
          <dt>Outer branch</dt>
          <dd data-metric="recursive-open">{open ? "open" : "closed"}</dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd data-metric="recursive-rows">{items.length}</dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd data-metric="recursive-updates">{updates}</dd>
        </div>
      </dl>

      <div className="heavy-controls composable-controls">
        <button data-action="recursive-update" type="button" onClick={updateInnerBlocks}>
          Update nested blocks <span aria-hidden="true">↗</span>
        </button>
        <button
          data-action="recursive-hide-update"
          type="button"
          onClick={() => {
            setOpen(false);
            updateInnerBlocks();
          }}
        >
          Hide and update
        </button>
        <button data-action="recursive-hidden-update" type="button" onClick={updateInnerBlocks}>
          Update while hidden
        </button>
        <button data-action="recursive-show" type="button" onClick={() => setOpen(true)}>
          Show latest state
        </button>
      </div>

      <div className="recursive-host-slot">
        {open ? (
          <article className="composable-stage" data-recursive-outer>
            <h3 data-recursive-static>Compiler-owned host tree</h3>
            <div className="recursive-status">
              {loading ? (
                <div data-recursive-loading="loading">
                  <p>Loading update {updates}</p>
                  <div>{details && <strong data-recursive-details>Details {updates}</strong>}</div>
                </div>
              ) : (
                <p data-recursive-loading="ready">Ready after {updates} updates</p>
              )}
            </div>
            <ul className="composable-row-set" data-recursive-list>
              <li data-recursive-fixed>Fixed row</li>
              {items.map((item) => (
                <li data-recursive-row={item.id} key={item.id}>
                  {item.label}
                </li>
              ))}
            </ul>
          </article>
        ) : (
          <aside className="composable-stage" data-recursive-closed>
            Outer host block is closed. Inner subscriptions are cleaned up.
          </aside>
        )}
      </div>
    </section>
  );
}
