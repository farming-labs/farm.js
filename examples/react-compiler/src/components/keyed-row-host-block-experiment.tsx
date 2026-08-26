"use client";

import { useState } from "react";

interface HostRow {
  id: string;
  label: string;
  done: boolean;
  detail: boolean;
  expanded: boolean;
}

const initialRows: HostRow[] = Array.from({ length: 1_000 }, (_, index) => ({
  id: `row-${index}`,
  label: `Task ${index}`,
  done: index % 2 === 0,
  detail: index % 3 === 0,
  expanded: index % 5 === 0,
}));

let keyedRowHostOwnerExecutions = 0;

export function KeyedRowHostBlockExperiment() {
  const [items, setItems] = useState(initialRows);
  const [updates, setUpdates] = useState(0);

  function rotateAndUpdateBranches() {
    setItems((rows) => {
      const rotated = [...rows.slice(1), rows[0]];
      return rotated.map((item) => {
        if (item.id === "row-0") {
          return {
            ...item,
            label: `${item.label} · branch replaced`,
            done: !item.done,
            expanded: !item.expanded,
          };
        }
        if (item.id === "row-12") {
          return {
            ...item,
            label: `${item.label} · nested patched`,
            detail: !item.detail,
            expanded: !item.expanded,
          };
        }
        return item;
      });
    });
    setUpdates((value) => value + 1);
  }

  function removeAndInsert() {
    setItems((rows) => [
      ...rows.filter((item) => item.id !== "row-10"),
      {
        id: `inserted-${updates}`,
        label: `Inserted after update ${updates}`,
        done: true,
        detail: true,
        expanded: true,
      },
    ]);
    setUpdates((value) => value + 1);
  }

  return (
    <section className="heavy-benchmark" data-experiment="keyed-row-host-blocks">
      <header className="heavy-heading">
        <div>
          <span className="experiment-number">10</span>
          <div>
            <p className="heavy-kicker">KEYED ROW HOST BLOCKS</p>
            <h2>Each keyed row owns its safe nested conditions</h2>
          </div>
        </div>
        <span className="node-badge">1,000 ROWS / LIS + HOST BRANCHES</span>
      </header>

      <p className="heavy-copy">
        React creates or hydrates the list once. The compiler then keeps each safe host-only row,
        its logical and ternary branches, and its deeper condition in one keyed instance. A single
        update can move rows and patch those branches without rerunning this component.
      </p>

      <dl className="heavy-metrics" aria-live="polite">
        <div>
          <dt>Owner executions</dt>
          <dd data-metric="keyed-host-owner-executions">
            {typeof window === "undefined" ? 1 : ++keyedRowHostOwnerExecutions}
          </dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd data-metric="keyed-host-rows">{items.length}</dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd data-metric="keyed-host-updates">{updates}</dd>
        </div>
        <div>
          <dt>First key</dt>
          <dd data-metric="keyed-host-first">{items[0]?.id || "empty"}</dd>
        </div>
      </dl>

      <div className="heavy-controls composable-controls">
        <button data-action="keyed-host-rotate" type="button" onClick={rotateAndUpdateBranches}>
          Rotate + update conditions <span aria-hidden="true">↗</span>
        </button>
        <button data-action="keyed-host-replace" type="button" onClick={removeAndInsert}>
          Remove + insert row
        </button>
      </div>

      <ul className="keyed-host-row-list" data-keyed-host-list>
        {items.map((item, index) => (
          <li data-index={index} data-keyed-host-row={item.id} key={item.id}>
            <span>{item.label}</span>
            <div className="keyed-host-status" data-keyed-host-status>
              <i>STATE</i>
              {item.done ? (
                <article
                  className={item.detail ? "keyed-host-branch--detail" : ""}
                  data-keyed-host-branch="done"
                  style={{ opacity: item.detail ? 1 : 0.72 }}
                >
                  <strong>{item.label} complete</strong>
                  <div>
                    {item.detail && (
                      <small title={item.label} data-keyed-host-detail>
                        {item.label} detail
                      </small>
                    )}
                  </div>
                </article>
              ) : (
                <aside data-keyed-host-branch="open">{item.label} open</aside>
              )}
              <b>PREPARED</b>
            </div>
            <section data-keyed-host-extra>
              {item.expanded && <em>{item.label} expanded</em>}
            </section>
          </li>
        ))}
      </ul>
    </section>
  );
}
