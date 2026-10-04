import React, { useState } from "react";
import { createRoot } from "react-dom/client";

interface Row {
  id: number;
  label: string;
}

export function PlainKeyedTable() {
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: 1_000 }, (_, id) => ({ id, label: `Row ${id}` })),
  );
  const [selected, setSelected] = useState(-1);
  return (
    <main>
      <button onClick={() => setRows((value) => value)}>Keep rows</button>
      <button onClick={() => setSelected((value) => value + 1)}>Select next</button>
      <ul>
        {rows.map((row, index) => (
          <li className={index === selected ? "selected" : ""} key={row.id}>
            {row.label}
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<PlainKeyedTable />);
