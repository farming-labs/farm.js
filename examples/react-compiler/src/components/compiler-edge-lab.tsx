"use client";

import { List } from "@farm.js/react/list";
import { useState } from "react";

let compiledBatchExecutions = 0;
let reactBatchExecutions = 0;
let multipleBindingExecutions = 0;
let automaticListExecutions = 0;
let derivedCollectionExecutions = 0;
let explicitListExecutions = 0;

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

interface ListItem {
  id: string;
  label: string;
}

export function AutomaticKeyedListExperiment() {
  const [items, setItems] = useState<ListItem[]>([
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ]);

  return (
    <article className="edge-card" data-experiment="keyed-automatic">
      <header>
        <span className="experiment-number">04A</span>
        <div>
          <h3>Compiled keyed rows</h3>
          <p>AOT row instances patch and reorder host rows without rerunning the list.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Items</dt>
          <dd data-metric="items">{items.length}</dd>
        </div>
        <div>
          <dt>First row</dt>
          <dd data-metric="first">{items[0]?.label}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++automaticListExecutions}
          </dd>
        </div>
      </dl>
      <ul data-list="keyed">
        {items.map((item) => (
          <li data-key={item.id} key={item.id}>
            {item.label}
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button
          type="button"
          data-action="add-item"
          onClick={() =>
            setItems((value) => [
              ...value,
              { id: `item-${value.length + 1}`, label: `Item ${value.length + 1}` },
            ])
          }
        >
          Add item
        </button>
        <button
          type="button"
          data-action="reverse-items"
          onClick={() => setItems((value) => [...value].reverse())}
        >
          Reverse rows
        </button>
      </div>
    </article>
  );
}

interface PipelineItem extends ListItem {
  rank: number;
  visible: boolean;
}

export function DerivedCollectionExperiment() {
  const [items, setItems] = useState<PipelineItem[]>([
    { id: "a", label: "Alpha", rank: 3, visible: true },
    { id: "b", label: "Beta", rank: 1, visible: true },
    { id: "c", label: "Gamma", rank: 2, visible: false },
    { id: "d", label: "Delta", rank: 4, visible: true },
  ]);
  const [minimumRank, setMinimumRank] = useState(0);
  const [pageSize, setPageSize] = useState(3);
  const [descending, setDescending] = useState(false);
  const visibleItems = items.filter(
    (item) => item.visible && item.rank >= minimumRank,
  );
  const orderedItems = visibleItems.toSorted((left, right) =>
    descending ? right.rank - left.rank : left.rank - right.rank,
  );
  const pageItems = orderedItems.slice(0, pageSize).toReversed();

  return (
    <article className="edge-card" data-experiment="derived-collection">
      <header>
        <span className="experiment-number">04B</span>
        <div>
          <h3>Derived keyed collection</h3>
          <p>Filter, order, and window dependencies feed the same keyed-row runtime.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Minimum rank</dt>
          <dd data-metric="minimum-rank">{minimumRank}</dd>
        </div>
        <div>
          <dt>Direction</dt>
          <dd data-metric="direction">{descending ? "descending" : "ascending"}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++derivedCollectionExecutions}
          </dd>
        </div>
      </dl>
      <ol data-list="derived-collection">
        {pageItems.map((item) => (
          <li data-key={item.id} data-rank={item.rank} key={item.id}>
            {item.label}
          </li>
        ))}
      </ol>
      <div className="button-row">
        <button
          type="button"
          data-action="filter-items"
          onClick={() => setMinimumRank((value) => (value === 0 ? 2 : 0))}
        >
          Toggle filter
        </button>
        <button
          type="button"
          data-action="sort-items"
          onClick={() => setDescending((value) => !value)}
        >
          Reverse order
        </button>
        <button
          type="button"
          data-action="resize-page"
          onClick={() => setPageSize((value) => (value === 3 ? 2 : 3))}
        >
          Resize window
        </button>
        <button
          type="button"
          data-action="update-derived-row"
          onClick={() =>
            setItems((value) =>
              value.map((item) =>
                item.id === "a" ? { ...item, label: "Axiom", rank: 5 } : item,
              ),
            )
          }
        >
          Update row
        </button>
        <button
          type="button"
          data-action="stress-items"
          onClick={() =>
            setItems(
              Array.from({ length: 2048 }, (_, index) => ({
                id: `stress-${index}`,
                label: `Row ${index}`,
                rank: index % 97,
                visible: index % 2 === 0,
              })),
            )
          }
        >
          Load 2,048 rows
        </button>
      </div>
    </article>
  );
}

function StatefulListRow({ item }: { item: ListItem }) {
  const [clicks, setClicks] = useState(0);
  return (
    <button data-row={item.id} type="button" onClick={() => setClicks((value) => value + 1)}>
      {item.label} · {clicks}
    </button>
  );
}

export function ExplicitKeyedListExperiment() {
  const [items, setItems] = useState<ListItem[]>([
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ]);

  return (
    <article className="edge-card" data-experiment="keyed-explicit">
      <header>
        <span className="experiment-number">04C</span>
        <div>
          <h3>Explicit List boundary</h3>
          <p>A key selector supports custom rows while React preserves their state.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Items</dt>
          <dd data-metric="items">{items.length}</dd>
        </div>
        <div>
          <dt>First row</dt>
          <dd data-metric="first">{items[0]?.label}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++explicitListExecutions}
          </dd>
        </div>
      </dl>
      <div className="keyed-row-stage" data-list="explicit">
        <List each={items} by={(item) => item.id}>
          {(item) => <StatefulListRow item={item} />}
        </List>
      </div>
      <button
        data-action="reverse-items"
        type="button"
        onClick={() => setItems((value) => [...value].reverse())}
      >
        Reverse stateful rows
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
      <div className="edge-grid edge-grid--single">
        <MultipleBindingExperiment />
      </div>
      <div className="edge-grid">
        <AutomaticKeyedListExperiment />
        <DerivedCollectionExperiment />
        <ExplicitKeyedListExperiment />
      </div>

      <aside className="hook-warning">
        <span>HOOKS + KEYS</span>
        <p>
          Never call a Hook directly inside <code>items.map(...)</code>. Put the
          Hook in a separate keyed row component. A host-only map can use compiled
          rows; a component row keeps identity, Hooks, and lifecycle under React.
        </p>
      </aside>
    </section>
  );
}
