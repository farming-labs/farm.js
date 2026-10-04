import { useState } from "react";
import { buildRows, type Row } from "./workload";

export function Bench() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState(0);

  const create = () => setRows(buildRows(1_000));
  const update = () =>
    setRows((current) =>
      current.map((row, index) =>
        index % 10 === 0 ? { id: row.id, label: `${row.label} !!!` } : row,
      ),
    );
  const select = () => setSelected((current) => current + 1);
  const swap = () =>
    setRows((current) => {
      if (current.length < 999) return current;
      const copy = current.slice();
      const first = copy[1];
      copy[1] = copy[998];
      copy[998] = first;
      return copy;
    });
  const append = () => setRows((current) => [...current, ...buildRows(100)]);
  const remove = () => setRows((current) => current.filter((_, index) => index % 10 !== 0));
  const clear = () => setRows([]);

  return (
    <main data-bench-root="ready">
      <div className="controls">
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
        <button id="append" onClick={append} type="button">
          Append 100 rows
        </button>
        <button id="remove" onClick={remove} type="button">
          Remove every 10th
        </button>
        <button id="clear" onClick={clear} type="button">
          Clear
        </button>
      </div>
      <p data-row-count={rows.length}>
        {rows.length} rows, selection tick {selected}
      </p>
      <div id="rows">
        {rows.map((row, index) => (
          <div
            className={index === selected % 1_000 ? "row selected" : "row"}
            data-row-id={row.id}
            key={row.id}
          >
            <span>{row.id}</span>
            <strong>{row.label}</strong>
            <input aria-label={`Draft for row ${row.id}`} defaultValue={`draft-${row.id}`} />
          </div>
        ))}
      </div>
    </main>
  );
}
