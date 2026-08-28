import React, { useState } from "react";
import { createRoot } from "react-dom/client";

interface Row {
  id: number;
  label: string;
}

export function PrependTable() {
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: 1_000 }, (_, id) => ({ id, label: `Row ${id}` })),
  );
  return (
    <main>
      <button
        onClick={() =>
          setRows((current) => [{ id: current.length, label: `Row ${current.length}` }, ...current])
        }
      >
        Prepend
      </button>
      <ul>
        {rows.map((row) => (
          <li data-id={row.id} key={row.id}>
            {row.label}
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<PrependTable />);
