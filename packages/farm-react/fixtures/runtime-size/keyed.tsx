import React, { useState } from "react";
import { createRoot } from "react-dom/client";

interface Row {
  id: number;
  label: string;
}

export function KeyedTable() {
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: 1_000 }, (_, id) => ({ id, label: `Row ${id}` })),
  );
  const [selected, setSelected] = useState(-1);
  const [marked, setMarked] = useState(() => new Set<number>());
  const [queueById, setQueueById] = useState(() => new Map<number, string>());
  return (
    <main>
      <button onClick={() => setRows((value) => [...value].reverse())}>Reverse</button>
      <ul>
        {rows.map((row) => (
          <li
            className={selected === row.id ? "selected" : ""}
            data-marked={marked.has(row.id)}
            data-queue={queueById.get(row.id) ?? "none"}
            key={row.id}
            onClick={() => {
              setSelected(row.id);
              setMarked((current) => new Set(current).add(row.id));
              setQueueById((current) => new Map(current).set(row.id, "ready"));
            }}
          >
            {row.label}
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<KeyedTable />);
