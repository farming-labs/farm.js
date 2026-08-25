"use client";

import { useState } from "react";

// The workload deliberately stays inside the compiler contract: one host root,
// top-level useState, synchronous handlers, keyed rows, row-local ternaries,
// no refs or effects. The same source builds both variants; only the
// FARM_BENCH_COMPILER env flag differs between them.

type Row = { id: number; label: string };

const ADJECTIVES = [
  "pretty",
  "large",
  "big",
  "small",
  "tall",
  "short",
  "long",
  "handsome",
  "plain",
  "quaint",
];
const NOUNS = [
  "table",
  "chair",
  "house",
  "bbq",
  "desk",
  "car",
  "pony",
  "cookie",
  "sandwich",
  "burger",
];

let nextId = 1;

function buildRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = nextId;
    nextId += 1;
    rows.push({
      id,
      label: `${ADJECTIVES[id % ADJECTIVES.length]} ${NOUNS[id % NOUNS.length]} ${id}`,
    });
  }
  return rows;
}

export function Bench() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState(0);

  function create() {
    setRows(buildRows(1000));
  }

  function update() {
    setRows((current) =>
      current.map((row, index) =>
        index % 10 === 0 ? { id: row.id, label: `${row.label} !!!` } : row,
      ),
    );
  }

  function select() {
    setSelected((current) => current + 1);
  }

  function swap() {
    setRows((current) => {
      if (current.length < 999) return current;
      const copy = current.slice();
      const first = copy[1];
      copy[1] = copy[998];
      copy[998] = first;
      return copy;
    });
  }

  function clear() {
    setRows([]);
  }

  return (
    <div data-bench-root="ready">
      <div>
        <button id="create" onClick={create} type="button">
          Create 1,000 rows
        </button>
        <button id="update" onClick={update} type="button">
          Update every 10th
        </button>
        <button id="select" onClick={select} type="button">
          Select next
        </button>
        <button id="swap" onClick={swap} type="button">
          Swap rows
        </button>
        <button id="clear" onClick={clear} type="button">
          Clear
        </button>
      </div>
      <p data-row-count={rows.length}>
        {rows.length} rows, selection tick {selected}
      </p>
      <div>
        {rows.map((row, index) => (
          <div
            key={row.id}
            className={index === selected % 1000 ? "row selected" : "row"}
          >
            <span>{row.id}</span>
            <strong>{row.label}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
