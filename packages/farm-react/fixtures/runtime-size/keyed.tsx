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
  return (
    <main>
      <button onClick={() => setRows((value) => [...value].reverse())}>Reverse</button>
      <ul>
        {rows.map((row) => (
          <li
            className={selected === row.id ? "selected" : ""}
            key={row.id}
            onClick={() => setSelected(row.id)}
          >
            {row.label}
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<KeyedTable />);
