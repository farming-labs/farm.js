"use client";

import { useState } from "react";

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
  const [operation, setOperation] = useState("initial 100 rows");
  const [revision, setRevision] = useState(0);

  return (
    <section
      className="table-benchmark"
      data-benchmark="table"
      data-revision={revision}
      data-selected={selected}
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
            setSeed(nextSeed);
            setRows((current) => [...current, ...buildRows(1_000, nextSeed)]);
            setOperation("append 1,000");
            setRevision((value) => value + 1);
          }}
        >
          Append 1,000
        </button>
        <button
          data-action="table-replace"
          type="button"
          onClick={() => {
            const nextSeed = seed + 1;
            setSeed(nextSeed);
            setRows(buildRows(1_000, nextSeed));
            setSelected(0);
            setOperation("replace 1,000");
            setRevision((value) => value + 1);
          }}
        >
          Replace 1,000
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
            {rows.map((row, index) => (
              <tr
                className={selected === row.id ? "table-row--selected" : ""}
                data-row-id={row.id}
                data-selected={selected === row.id}
                key={row.id}
              >
                <td>
                  <span className="row-index">{index + 1}</span>
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
