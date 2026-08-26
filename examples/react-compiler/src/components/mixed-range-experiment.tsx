"use client";

import { useState } from "react";

interface MixedTag {
  id: string;
  label: string;
}

interface MixedItem {
  id: string;
  label: string;
  visible: boolean;
  tags: MixedTag[];
}

const initialItems: MixedItem[] = Array.from({ length: 32 }, (_, itemIndex) => ({
  id: `mixed-item-${itemIndex}`,
  label: `Item ${itemIndex}`,
  visible: itemIndex % 2 === 0,
  tags: Array.from({ length: 3 }, (_, tagIndex) => ({
    id: `mixed-tag-${itemIndex}-${tagIndex}`,
    label: `Tag ${itemIndex}.${tagIndex}`,
  })),
}));

let mixedRangeOwnerExecutions = 0;

export function MixedRangeExperiment() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [items, setItems] = useState(initialItems);
  const [updates, setUpdates] = useState(0);

  function reconcileMixedRanges() {
    setLoading(true);
    setError((value) => !value);
    setItems((current) => {
      const rotated = [current[current.length - 1], ...current.slice(0, -1)];
      return rotated.map((item) =>
        item.id === "mixed-item-0"
          ? {
              ...item,
              label: "Item 0 · updated",
              visible: !item.visible,
              tags: [
                { ...item.tags[2], label: "Tag 0.2 · moved" },
                item.tags[0],
                item.tags[1],
              ],
            }
          : item,
      );
    });
    setUpdates((value) => value + 1);
  }

  function replaceOneRow() {
    setLoading(false);
    setItems((current) => [
      ...current.filter((item) => item.id !== "mixed-item-1"),
      {
        id: `mixed-inserted-${updates}`,
        label: `Inserted after update ${updates}`,
        visible: true,
        tags: [],
      },
    ]);
    setUpdates((value) => value + 1);
  }

  return (
    <section className="heavy-benchmark" data-experiment="mixed-ranges">
      <header className="heavy-heading">
        <div>
          <span className="experiment-number">13</span>
          <div>
            <p className="heavy-kicker">MIXED RECURSIVE RANGES</p>
            <h2>Conditions and keyed lists share one ordered container</h2>
          </div>
        </div>
        <span className="node-badge">32 ROWS / 96 NESTED TAGS</span>
      </header>

      <p className="heavy-copy">
        One compiler controller owns interleaved conditional and keyed ranges. It patches branches,
        applies LIS moves, and recursively updates each safe row while preserving static siblings.
      </p>

      <dl className="heavy-metrics" aria-live="polite">
        <div>
          <dt>Owner executions</dt>
          <dd data-metric="mixed-range-owner-executions">
            {typeof window === "undefined" ? 1 : ++mixedRangeOwnerExecutions}
          </dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd data-metric="mixed-range-rows">{items.length}</dd>
        </div>
        <div>
          <dt>Loading</dt>
          <dd data-metric="mixed-range-loading">{loading ? "shown" : "hidden"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd data-metric="mixed-range-status">{error ? "error" : "ready"}</dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd data-metric="mixed-range-updates">{updates}</dd>
        </div>
      </dl>

      <div className="heavy-controls composable-controls">
        <button data-action="mixed-range-reconcile" type="button" onClick={reconcileMixedRanges}>
          Reconcile every range <span aria-hidden="true">↗</span>
        </button>
        <button data-action="mixed-range-replace" type="button" onClick={replaceOneRow}>
          Replace one row
        </button>
      </div>

      <div className="keyed-host-row-list" data-mixed-range-list>
        <header data-mixed-static="header">MIXED INVENTORY</header>
        {loading && <p data-mixed-loading>Loading inventory…</p>}
        <i data-mixed-static="rows-before">ROWS</i>
        {items.map((item, itemIndex) => (
          <article data-mixed-item={item.id} data-item-index={itemIndex} key={item.id}>
            <h3>{item.label}</h3>
            <div data-mixed-tag-list={item.id}>
              {item.visible && <strong data-mixed-visible={item.id}>Visible</strong>}
              <i data-mixed-static="tags-before">TAGS</i>
              {item.tags.map((tag, tagIndex) => (
                <em data-mixed-tag={tag.id} data-tag-index={tagIndex} key={tag.id}>
                  {tag.label}
                </em>
              ))}
            </div>
          </article>
        ))}
        {error ? <strong data-mixed-status="error">Error</strong> : <span data-mixed-status="ready">Ready</span>}
        <footer data-mixed-static="footer">END MIXED INVENTORY</footer>
      </div>
    </section>
  );
}
