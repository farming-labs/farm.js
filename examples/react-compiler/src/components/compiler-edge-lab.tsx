"use client";

import { List } from "@farm.js/react/list";
import { useState } from "react";

let compiledBatchExecutions = 0;
let reactBatchExecutions = 0;
let multipleBindingExecutions = 0;
let automaticListExecutions = 0;
let derivedCollectionExecutions = 0;
let interactiveListExecutions = 0;
let editableListExecutions = 0;
let rowConditionalListExecutions = 0;
let explicitListExecutions = 0;
let keyedRangeExecutions = 0;

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

interface InteractiveListItem extends ListItem {
  done: boolean;
}

export function InteractiveKeyedListExperiment() {
  const [items, setItems] = useState<InteractiveListItem[]>([
    { id: "a", label: "Alpha", done: false },
    { id: "b", label: "Beta", done: false },
    { id: "c", label: "Gamma", done: false },
  ]);
  const [captured, setCaptured] = useState(0);

  return (
    <article className="edge-card" data-experiment="keyed-interactive">
      <header>
        <span className="experiment-number">04C</span>
        <div>
          <h3>Interactive compiled rows</h3>
          <p>React owns events and reorders; Farm patches same-key data without stale items.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>First row</dt>
          <dd data-metric="first">{items[0]?.label}</dd>
        </div>
        <div>
          <dt>Captured clicks</dt>
          <dd data-metric="captured">{captured}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++interactiveListExecutions}
          </dd>
        </div>
      </dl>
      <ul
        className="interactive-keyed-list"
        data-list="interactive"
        onClickCapture={() => setCaptured((value) => value + 1)}
      >
        {items.map((item, index) => (
          <li
            className={item.done ? "interactive-row interactive-row--done" : "interactive-row"}
            data-done={item.done}
            data-key={item.id}
            key={item.id}
          >
            <span>
              {item.label} · {item.done ? "done" : "open"}
            </span>
            <button
              data-action="toggle-interactive-row"
              data-index={index}
              data-key={item.id}
              onClick={(event) => {
                event.stopPropagation();
                setItems((current) =>
                  current.map((row) =>
                    row.id === item.id
                      ? { ...row, done: !item.done, label: `${item.label}!` }
                      : row,
                  ),
                );
              }}
              type="button"
            >
              Toggle
            </button>
          </li>
        ))}
      </ul>
      <button
        data-action="reverse-interactive-rows"
        onClick={() => setItems((current) => [...current].reverse())}
        type="button"
      >
        Reverse interactive rows
      </button>
    </article>
  );
}

interface EditableListItem extends InteractiveListItem {
  priority: "low" | "high";
}

export function EditableKeyedListExperiment() {
  const [items, setItems] = useState<EditableListItem[]>([
    { id: "a", label: "Compiler graph", done: false, priority: "high" },
    { id: "b", label: "Hydration pass", done: true, priority: "low" },
    { id: "c", label: "Runtime cleanup", done: false, priority: "high" },
  ]);
  const [edits, setEdits] = useState(0);

  return (
    <article className="edge-card" data-experiment="keyed-editable">
      <header>
        <span className="experiment-number">04D</span>
        <div>
          <h3>Editable keyed rows</h3>
          <p>Each input stays with its key while Farm patches values, checks, and row output.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Rows</dt>
          <dd data-metric="rows">{items.length}</dd>
        </div>
        <div>
          <dt>Edits</dt>
          <dd data-metric="edits">{edits}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++editableListExecutions}
          </dd>
        </div>
      </dl>
      <ul className="editable-keyed-list" data-list="editable">
        {items.map((item, index) => (
          <li
            className={
              item.done ? "editable-keyed-row editable-keyed-row--done" : "editable-keyed-row"
            }
            data-key={item.id}
            key={item.id}
          >
            <label>
              <span>Name</span>
              <input
                aria-label={`Name for ${item.id}`}
                data-control="name"
                onChange={(event) => {
                  setItems((current) =>
                    current.map((row) =>
                      row.id === item.id ? { ...row, label: event.currentTarget.value } : row,
                    ),
                  );
                  setEdits((value) => value + 1);
                }}
                value={item.label}
              />
            </label>
            <label>
              <span>Priority</span>
              <select
                aria-label={`Priority for ${item.id}`}
                data-control="priority"
                onChange={(event) => {
                  setItems((current) =>
                    current.map((row) =>
                      row.id === item.id
                        ? {
                            ...row,
                            priority: event.currentTarget.value as EditableListItem["priority"],
                          }
                        : row,
                    ),
                  );
                  setEdits((value) => value + 1);
                }}
                value={item.priority}
              >
                <option value="low">Low</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="editable-keyed-check">
              <input
                aria-label={`Done for ${item.id}`}
                checked={item.done}
                data-control="done"
                onChange={(event) => {
                  setItems((current) =>
                    current.map((row) =>
                      row.id === item.id ? { ...row, done: event.currentTarget.checked } : row,
                    ),
                  );
                  setEdits((value) => value + 1);
                }}
                type="checkbox"
              />
              <span>Completed</span>
            </label>
            <output data-row-output={item.id}>
              ROW {index + 1} · {item.label} · {item.priority} · {item.done ? "done" : "open"}
            </output>
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button
          data-action="rotate-editable-rows"
          onClick={() => setItems((current) => [current[2], current[0], current[1]])}
          type="button"
        >
          Rotate rows
        </button>
        <button
          data-action="load-editable-rows"
          onClick={() =>
            setItems(
              Array.from({ length: 256 }, (_, index) => ({
                id: `editable-${index}`,
                label: `Task ${index}`,
                done: index % 3 === 0,
                priority: index % 2 === 0 ? "high" : "low",
              })),
            )
          }
          type="button"
        >
          Load 256 rows
        </button>
      </div>
    </article>
  );
}

interface ConditionalListItem extends InteractiveListItem {
  expanded: boolean;
}

export function RowConditionalListExperiment() {
  const [items, setItems] = useState<ConditionalListItem[]>([
    { id: "a", label: "Compiler graph", done: true, expanded: true },
    { id: "b", label: "Hydration checks", done: false, expanded: false },
    { id: "c", label: "Runtime cleanup", done: false, expanded: true },
  ]);
  const visibleDetails =
    Number(items[0]?.expanded) + Number(items[1]?.expanded) + Number(items[2]?.expanded);
  const completedItems =
    Number(items[0]?.done) + Number(items[1]?.done) + Number(items[2]?.done);

  return (
    <article className="edge-card" data-experiment="keyed-row-conditionals">
      <header>
        <span className="experiment-number">04E</span>
        <div>
          <h3>Conditional row blocks</h3>
          <p>Each key owns small branch boundaries that update independently.</p>
        </div>
      </header>
      <dl className="compact-metrics" aria-live="polite">
        <div>
          <dt>Open details</dt>
          <dd data-metric="details">{visibleDetails}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd data-metric="completed">{completedItems}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++rowConditionalListExecutions}
          </dd>
        </div>
      </dl>
      <ul className="conditional-row-list" data-list="row-conditionals">
        {items.map((item, index) => (
          <li className="conditional-row" data-key={item.id} key={item.id}>
            <div className="conditional-row__summary">
              <span>{item.label}</span>
              <small>ROW {index + 1}</small>
            </div>
            <div className="conditional-row__status" data-slot="status">
              {item.done ? (
                <strong>{item.label} complete</strong>
              ) : (
                <span>In progress</span>
              )}
            </div>
            <div className="conditional-row__details" data-slot="details">
              {item.expanded && <p>{item.label} keeps its keyed DOM identity.</p>}
            </div>
            <div className="conditional-row__actions">
              <button
                data-action="toggle-row-status"
                onClick={() =>
                  setItems((current) =>
                    current.map((row) =>
                      row.id === item.id ? { ...row, done: !item.done } : row,
                    ),
                  )
                }
                type="button"
              >
                {item.done ? "Reopen" : "Complete"}
              </button>
              <button
                aria-expanded={item.expanded}
                data-action="toggle-row-details"
                onClick={() =>
                  setItems((current) =>
                    current.map((row) =>
                      row.id === item.id ? { ...row, expanded: !item.expanded } : row,
                    ),
                  )
                }
                type="button"
              >
                {item.expanded ? "Hide details" : "Show details"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        data-action="rotate-conditional-rows"
        onClick={() => setItems((current) => [current[2], current[0], current[1]])}
        type="button"
      >
        Rotate keyed rows
      </button>
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
        <span className="experiment-number">04F</span>
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

export function KeyedRangeExperiment() {
  const [primary, setPrimary] = useState<ListItem[]>([
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
    { id: "d", label: "Delta" },
  ]);
  const [secondary, setSecondary] = useState<ListItem[]>([
    { id: "x", label: "Xray" },
    { id: "y", label: "Yankee" },
    { id: "z", label: "Zulu" },
  ]);
  const total = primary.length + secondary.length;

  return (
    <article
      className="edge-card keyed-range-root"
      data-experiment="keyed-ranges"
      data-list="ranges"
      data-rows={total}
    >
      <header data-static="range-header">
        <span className="experiment-number">04G</span>
        <div>
          <h3>Root keyed ranges</h3>
          <p>The card itself owns two lists without an extra wrapper, marker, or React rerender.</p>
        </div>
      </header>
      <dl className="compact-metrics" data-static="range-metrics" aria-live="polite">
        <div>
          <dt>Ranges</dt>
          <dd data-metric="ranges">2</dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd data-metric="rows">{total}</dd>
        </div>
        <div>
          <dt>Executions</dt>
          <dd data-metric="executions">
            {typeof window === "undefined" ? 1 : ++keyedRangeExecutions}
          </dd>
        </div>
      </dl>
      <div className="keyed-range-static" data-static="range-primary-label">
        PRIMARY RANGE
      </div>
      {primary.map((item, index) => (
        <div data-index={index} data-key={item.id} data-range="primary" key={item.id}>
          {index + 1}. {item.label}
        </div>
      ))}
      <div className="keyed-range-static" data-static="range-divider">
        SECONDARY RANGE
      </div>
      {secondary.map((item, index) => (
        <div data-index={index} data-key={item.id} data-range="secondary" key={item.id}>
          {index + 1}. {item.label}
        </div>
      ))}
      <footer className="keyed-range-footer" data-static="range-footer">
        <span data-range-summary>{total} ROWS / ROOT SHELL</span>
        <div className="button-row">
          <button
            data-action="rotate-ranges"
            onClick={() => {
              setPrimary((items) =>
                items.length > 1
                  ? [items[items.length - 1], ...items.slice(0, items.length - 1)]
                  : items,
              );
              setSecondary((items) => [...items].reverse());
            }}
            type="button"
          >
            Rotate both ranges
          </button>
          <button
            data-action="clear-ranges"
            onClick={() => {
              setPrimary([]);
              setSecondary([]);
            }}
            type="button"
          >
            Empty ranges
          </button>
          <button
            data-action="stress-ranges"
            onClick={() => {
              setPrimary(
                Array.from({ length: 512 }, (_, index) => ({
                  id: `primary-${index}`,
                  label: `Primary ${index}`,
                })),
              );
              setSecondary(
                Array.from({ length: 512 }, (_, index) => ({
                  id: `secondary-${index}`,
                  label: `Secondary ${index}`,
                })),
              );
            }}
            type="button"
          >
            Load 1,024 rows
          </button>
        </div>
      </footer>
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
        <InteractiveKeyedListExperiment />
        <EditableKeyedListExperiment />
        <RowConditionalListExperiment />
        <ExplicitKeyedListExperiment />
        <KeyedRangeExperiment />
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
