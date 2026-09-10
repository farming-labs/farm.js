import React, { useState } from "react";
import { createRoot } from "react-dom/client";

interface Row {
  id: number;
  label: string;
}

export function StructuralAppendMapTable() {
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: 1_000 }, (_, id) => ({ id, label: `Row ${id}` })),
  );
  return (
    <main>
      <button
        onClick={() => {
          setRows((current) => current.slice(1));
          setRows((current) => [...current, { id: 1_001, label: "Appended row" }]);
          setRows((current) =>
            current.map((row) => (row.id === 750 ? { ...row, label: "Updated row" } : row)),
          );
        }}
      >
        Replace and update
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

createRoot(document.body).render(<StructuralAppendMapTable />);
