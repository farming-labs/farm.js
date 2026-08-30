"use client";

import { useState } from "react";

declare global {
  interface Array<T> {
    toReversed(): T[];
    toSorted(compare?: (left: T, right: T) => number): T[];
    toSpliced(start: number, deleteCount: number): T[];
    toSpliced(start: number, deleteCount: number, item: T): T[];
    with(index: number, item: T): T[];
  }
}

interface BenchmarkRow {
  id: number;
  label: string;
  amount: number;
  region: string;
  status: "paid" | "review" | "failed";
}

const adjectives = [
  "adaptive",
  "brisk",
  "calm",
  "direct",
  "elastic",
  "fast",
  "global",
  "honest",
] as const;
const colors = ["amber", "blue", "coral", "green", "indigo", "silver", "violet"] as const;
const nouns = ["account", "checkout", "invoice", "order", "payout", "shipment", "wallet"] as const;
const regions = ["AMR", "EMEA", "APAC"] as const;

function buildRows(count: number, seed: number): BenchmarkRow[] {
  return Array.from({ length: count }, (_, index) => {
    const id = seed * 10_000 + index + 1;
    return {
      id,
      label: `${adjectives[id % adjectives.length]} ${colors[id % colors.length]} ${nouns[id % nouns.length]}`,
      amount: 35 + ((id * 47) % 9_500),
      region: regions[id % regions.length],
      status: id % 17 === 0 ? "failed" : id % 7 === 0 ? "review" : "paid",
    };
  });
}

let tableExecutions = 0;

export function StandardTableBenchmark() {
  const [rows, setRows] = useState(() => buildRows(100, 0));
  const [seed, setSeed] = useState(0);
  const [selected, setSelected] = useState(0);
  const [markedIds, setMarkedIds] = useState(() => new Set<number>());
  const [queueById, setQueueById] = useState(() => new Map<number, string>());
  const [snapshotMarkedIds, setSnapshotMarkedIds] = useState(() => new Set<number>());
  const [snapshotQueueById, setSnapshotQueueById] = useState(() => new Map<number, string>());
  const [operation, setOperation] = useState("initial 100 rows");
  const [revision, setRevision] = useState(0);

  return (
    <section
      className="table-benchmark"
      data-benchmark="table"
      data-revision={revision}
      data-selected={selected}
      data-marked-count={markedIds.size}
      data-queue-count={queueById.size}
      id="table-benchmark"
    >
      <header className="benchmark-heading">
        <div>
          <span className="section-index">02 / STANDARD OPERATIONS</span>
          <h2>Keyed 1,000/10,000-row workload</h2>
          <p>
            The familiar create, replace, append, partial-update, select, swap, remove, and clear
            operations used by browser UI framework benchmarks.
          </p>
        </div>
        <dl className="benchmark-readout" aria-live="polite">
          <div>
            <dt>Rows</dt>
            <dd data-metric="table-rows">{rows.length}</dd>
          </div>
          <div>
            <dt>Owner executions</dt>
            <dd data-metric="table-executions">
              {typeof window === "undefined" ? 1 : ++tableExecutions}
            </dd>
          </div>
          <div>
            <dt>Last operation</dt>
            <dd data-metric="table-operation">{operation}</dd>
          </div>
        </dl>
      </header>

      <div className="benchmark-controls" aria-label="Table benchmark actions">
        <button
          data-action="table-create"
          id="run"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            setSeed(nextSeed);
            setRows(buildRows(1_000, nextSeed));
            setSelected(0);
            setMarkedIds(new Set());
            setQueueById(new Map());
            setSnapshotMarkedIds(new Set());
            setSnapshotQueueById(new Map());
            setOperation("create 1,000");
            setRevision((value) => value + 1);
          }}
        >
          Create 1,000
        </button>
        <button
          data-action="table-create-many"
          id="runlots"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            setSeed(nextSeed);
            setRows(buildRows(10_000, nextSeed));
            setSelected(0);
            setMarkedIds(new Set());
            setQueueById(new Map());
            setSnapshotMarkedIds(new Set());
            setSnapshotQueueById(new Map());
            setOperation("create 10,000");
            setRevision((value) => value + 1);
          }}
        >
          Create 10,000
        </button>
        <button
          data-action="table-append"
          id="add"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            const additions = buildRows(1_000, nextSeed);
            setSeed(nextSeed);
            setRows((current) => [...current, ...additions]);
            setOperation("append 1,000");
            setRevision((value) => value + 1);
          }}
        >
          Append 1,000
        </button>
        <button
          data-action="table-append-snapshot"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            setSeed(nextSeed);
            setRows((current) => {
              const additions = buildRows(1_000, nextSeed);
              return [...current, ...additions];
            });
            setOperation("append 1,000 (snapshot control)");
            setRevision((value) => value + 1);
          }}
        >
          Append 1,000 (snapshot control)
        </button>
        <button
          data-action="table-prepend"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            const additions = buildRows(1_000, nextSeed);
            setSeed(nextSeed);
            setRows((current) => [...additions, ...current]);
            setOperation("prepend 1,000");
            setRevision((value) => value + 1);
          }}
        >
          Prepend 1,000
        </button>
        <button
          data-action="table-prepend-snapshot"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            setSeed(nextSeed);
            setRows((current) => {
              const additions = buildRows(1_000, nextSeed);
              return [...additions, ...current];
            });
            setOperation("prepend 1,000 (snapshot control)");
            setRevision((value) => value + 1);
          }}
        >
          Prepend 1,000 (snapshot control)
        </button>
        <button
          data-action="table-drop-prefix"
          type="button"
          onClick={() => {
            setRows((current) => current.slice(1_000));
            setOperation("drop benchmark prefix");
            setRevision((value) => value + 1);
          }}
        >
          Drop benchmark prefix
        </button>
        <button
          data-action="table-drop-prefix-snapshot"
          type="button"
          onClick={() => {
            setRows((current) => {
              return current.slice(1_000);
            });
            setOperation("drop benchmark prefix (snapshot control)");
            setRevision((value) => value + 1);
          }}
        >
          Drop benchmark prefix (snapshot control)
        </button>
        <button
          data-action="table-roll-window"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            const additions = buildRows(1_000, nextSeed);
            setSeed(nextSeed);
            setRows((current) => [...current.slice(1_000), ...additions]);
            setOperation("roll benchmark window");
            setRevision((value) => value + 1);
          }}
        >
          Roll benchmark window
        </button>
        <button
          data-action="table-roll-window-snapshot"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            const additions = buildRows(1_000, nextSeed);
            setSeed(nextSeed);
            setRows((current) => {
              return [...current.slice(1_000), ...additions];
            });
            setOperation("roll benchmark window (snapshot control)");
            setRevision((value) => value + 1);
          }}
        >
          Roll benchmark window (snapshot control)
        </button>
        <button
          data-action="table-position-insert"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            const addition = buildRows(1, nextSeed)[0];
            const position = 9_000;
            setSeed(nextSeed);
            setRows((current) => current.toSpliced(position, 0, addition));
            setOperation("insert at runtime position");
            setRevision((value) => value + 1);
          }}
        >
          Insert at runtime position
        </button>
        <button
          data-action="table-position-insert-snapshot"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            const addition = buildRows(1, nextSeed)[0];
            const position = 9_000;
            setSeed(nextSeed);
            setRows((current) => {
              return current.toSpliced(position, 0, addition);
            });
            setOperation("insert at runtime position (snapshot control)");
            setRevision((value) => value + 1);
          }}
        >
          Insert at runtime position (snapshot control)
        </button>
        <button
          data-action="table-position-remove"
          type="button"
          onClick={() => {
            const position = 9_000;
            setRows((current) => current.toSpliced(position, 1));
            setOperation("remove at runtime position");
            setRevision((value) => value + 1);
          }}
        >
          Remove at runtime position
        </button>
        <button
          data-action="table-position-remove-snapshot"
          type="button"
          onClick={() => {
            const position = 9_000;
            setRows((current) => {
              return current.toSpliced(position, 1);
            });
            setOperation("remove at runtime position (snapshot control)");
            setRevision((value) => value + 1);
          }}
        >
          Remove at runtime position (snapshot control)
        </button>
        <button
          data-action="table-position-replace"
          type="button"
          onClick={() => {
            const position = 100;
            const current = rows[position];
            const replacement = { ...current, label: `${current.label} @` };
            setRows((items) => items.toSpliced(position, 1, replacement));
            setOperation("replace at runtime position");
            setRevision((value) => value + 1);
          }}
        >
          Replace at runtime position
        </button>
        <button
          data-action="table-position-replace-snapshot"
          type="button"
          onClick={() => {
            const position = 100;
            const current = rows[position];
            const replacement = { ...current, label: `${current.label} @` };
            setRows((items) => {
              return items.toSpliced(position, 1, replacement);
            });
            setOperation("replace at runtime position (snapshot control)");
            setRevision((value) => value + 1);
          }}
        >
          Replace at runtime position (snapshot control)
        </button>
        <button
          data-action="table-reverse"
          type="button"
          onClick={() => {
            setRows((current) => current.toReversed());
            setOperation("reverse rows");
            setRevision((value) => value + 1);
          }}
        >
          Reverse rows
        </button>
        <button
          data-action="table-reverse-snapshot"
          type="button"
          onClick={() => {
            setRows((current) => {
              return current.toReversed();
            });
            setOperation("reverse rows (snapshot control)");
            setRevision((value) => value + 1);
          }}
        >
          Reverse rows (snapshot control)
        </button>
        <button
          data-action="table-sort"
          type="button"
          onClick={() => {
            setRows((current) =>
              current.toSorted(
                (left, right) => left.amount - right.amount || left.id - right.id,
              ),
            );
            setOperation("sort rows");
            setRevision((value) => value + 1);
          }}
        >
          Sort rows
        </button>
        <button
          data-action="table-sort-snapshot"
          type="button"
          onClick={() => {
            setRows((current) => {
              return current.toSorted(
                (left, right) => left.amount - right.amount || left.id - right.id,
              );
            });
            setOperation("sort rows (snapshot control)");
            setRevision((value) => value + 1);
          }}
        >
          Sort rows (snapshot control)
        </button>
        <button
          data-action="table-replace"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            setSeed(nextSeed);
            setRows(buildRows(1_000, nextSeed));
            setSelected(0);
            setMarkedIds(new Set());
            setQueueById(new Map());
            setSnapshotMarkedIds(new Set());
            setSnapshotQueueById(new Map());
            setOperation("replace 1,000");
            setRevision((value) => value + 1);
          }}
        >
          Replace 1,000
        </button>
        <button
          data-action="table-remove-snapshot"
          type="button"
          onClick={() => {
            setRows((current) => {
              const target = current[Math.floor(current.length / 2)];
              return target ? current.filter((item) => item.id !== target.id) : current;
            });
            setOperation("remove row (snapshot control)");
            setRevision((value) => value + 1);
          }}
        >
          Remove middle (snapshot control)
        </button>
        <button
          data-action="table-update"
          id="update"
          type="button"
          onClick={() => {
            setRows((current) =>
              current.map((row, index) =>
                index % 10 === 0 ? { ...row, label: `${row.label} !!!` } : row,
              ),
            );
            setOperation("update every 10th");
            setRevision((value) => value + 1);
          }}
        >
          Update every 10th
        </button>
        <button
          data-action="table-mark"
          type="button"
          onClick={() => {
            setMarkedIds((current) => {
              const middle = Math.floor(rows.length / 2);
              const first = rows[middle]?.id;
              const second = rows[middle + 1]?.id;
              const third = rows[middle + 2]?.id;
              const fourth = rows[middle + 3]?.id;
              if (
                first === undefined ||
                second === undefined ||
                third === undefined ||
                fourth === undefined
              ) {
                return current;
              }
              const next = new Set(current);
              if (next.has(first)) {
                next.delete(first);
                next.delete(second);
                next.add(third);
                next.add(fourth);
              } else {
                next.delete(third);
                next.delete(fourth);
                next.add(first);
                next.add(second);
              }
              return next;
            });
            setOperation("mark two rows");
            setRevision((value) => value + 1);
          }}
        >
          Mark two rows
        </button>
        <button
          data-action="table-queue"
          type="button"
          onClick={() => {
            setQueueById((current) => {
              const middle = Math.floor(rows.length / 2);
              const first = rows[middle]?.id;
              const second = rows[middle + 1]?.id;
              const third = rows[middle + 2]?.id;
              const fourth = rows[middle + 3]?.id;
              if (
                first === undefined ||
                second === undefined ||
                third === undefined ||
                fourth === undefined
              ) {
                return current;
              }
              const next = new Map(current);
              if (next.has(first)) {
                next.delete(first);
                next.delete(second);
                next.set(third, "expedite");
                next.set(fourth, "hold");
              } else {
                next.delete(third);
                next.delete(fourth);
                next.set(first, "expedite");
                next.set(second, "hold");
              }
              return next;
            });
            setOperation("queue two rows");
            setRevision((value) => value + 1);
          }}
        >
          Queue two rows
        </button>
        <button
          data-action="table-seed-dense-targets"
          type="button"
          onClick={() => {
            setMarkedIds(new Set(rows.map((row) => row.id)));
            setQueueById(new Map(rows.map((row) => [row.id, "dense"])));
            setSnapshotMarkedIds(new Set(rows.map((row) => row.id)));
            setSnapshotQueueById(new Map(rows.map((row) => [row.id, "dense"])));
            setOperation("seed dense row targets");
            setRevision((value) => value + 1);
          }}
        >
          Seed dense targets
        </button>
        <button
          data-action="table-toggle-dense-mark"
          type="button"
          onClick={() => {
            setMarkedIds((current) => {
              const target = rows[Math.floor(rows.length / 2)]?.id;
              if (target === undefined) return current;
              const next = new Set(current);
              if (next.has(target)) next.delete(target);
              else next.add(target);
              return next;
            });
            setOperation("toggle one dense mark");
            setRevision((value) => value + 1);
          }}
        >
          Toggle one dense mark
        </button>
        <button
          data-action="table-update-dense-queue"
          type="button"
          onClick={() => {
            setQueueById((current) => {
              const target = rows[Math.floor(rows.length / 2)]?.id;
              if (target === undefined) return current;
              const next = new Map(current);
              next.set(target, next.get(target) === "priority" ? "dense" : "priority");
              return next;
            });
            setOperation("update one dense queue value");
            setRevision((value) => value + 1);
          }}
        >
          Update one dense queue value
        </button>
        <button
          data-action="table-toggle-snapshot-mark"
          type="button"
          onClick={() => {
            const target = rows[Math.floor(rows.length / 2)]?.id;
            if (target === undefined) return;
            const next = new Set(snapshotMarkedIds);
            if (next.has(target)) next.delete(target);
            else next.add(target);
            setSnapshotMarkedIds(next);
            setOperation("toggle one snapshot mark");
            setRevision((value) => value + 1);
          }}
        >
          Toggle one snapshot mark
        </button>
        <button
          data-action="table-update-snapshot-queue"
          type="button"
          onClick={() => {
            const target = rows[Math.floor(rows.length / 2)]?.id;
            if (target === undefined) return;
            const next = new Map(snapshotQueueById);
            next.set(target, next.get(target) === "priority" ? "dense" : "priority");
            setSnapshotQueueById(next);
            setOperation("update one snapshot queue value");
            setRevision((value) => value + 1);
          }}
        >
          Update one snapshot queue value
        </button>
        <button
          data-action="table-swap"
          id="swaprows"
          type="button"
          onClick={() => {
            setRows((current) =>
              current.length < 999
                ? current
                : [
                    current[0],
                    current[998],
                    ...current.slice(2, 998),
                    current[1],
                    current[999],
                    ...current.slice(1_000),
                  ],
            );
            setOperation("swap rows");
            setRevision((value) => value + 1);
          }}
        >
          Swap rows
        </button>
        <button
          data-action="table-clear"
          id="clear"
          type="button"
          onClick={() => {
            setRows([]);
            setSelected(0);
            setMarkedIds(new Set());
            setQueueById(new Map());
            setSnapshotMarkedIds(new Set());
            setSnapshotQueueById(new Map());
            setOperation("clear");
            setRevision((value) => value + 1);
          }}
        >
          Clear
        </button>
      </div>

      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Descriptor</th>
              <th scope="col">Region</th>
              <th scope="col">Amount</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody data-table-body>
            {rows.map((row) => (
              <tr
                className={selected === row.id ? "table-row--selected" : ""}
                data-marked={markedIds.has(row.id)}
                data-queue={queueById.get(row.id) ?? "none"}
                data-snapshot-marked={snapshotMarkedIds.has(row.id)}
                data-snapshot-queue={snapshotQueueById.get(row.id) ?? "none"}
                data-row-id={row.id}
                data-selected={selected === row.id}
                key={row.id}
              >
                <td>
                  <span className="row-index">{row.id}</span>
                  <code>ord_{row.id}</code>
                </td>
                <td>{row.label}</td>
                <td>{row.region}</td>
                <td>${row.amount}</td>
                <td>
                  <span className={`status status--${row.status}`}>{row.status}</span>
                </td>
                <td className="row-actions">
                  <button
                    aria-label={`Select order ${row.id}`}
                    data-action="select-row"
                    data-row-id={row.id}
                    type="button"
                    onClick={() => {
                      setSelected(row.id);
                      setOperation("select row");
                      setRevision((value) => value + 1);
                    }}
                  >
                    Select
                  </button>
                  <button
                    aria-label={`Remove order ${row.id}`}
                    data-action="remove-row"
                    data-row-id={row.id}
                    type="button"
                    onClick={() => {
                      setRows((current) => current.filter((item) => item.id !== row.id));
                      setOperation("remove row");
                      setRevision((value) => value + 1);
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="empty-state">
            <strong>No benchmark rows</strong>
            <span>Choose “Create 1,000” to restore the workload.</span>
          </div>
        )}
      </div>
    </section>
  );
}
