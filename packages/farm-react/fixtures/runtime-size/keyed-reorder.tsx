import { useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Array<T> {
    toReversed(): T[];
  }
}

interface Row {
  id: number;
  label: string;
}

export function ReorderTable() {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: "Alpha" },
    { id: 2, label: "Beta" },
  ]);
  return (
    <main>
      <button onClick={() => setRows((current) => current.toReversed())}>Reverse rows</button>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{row.label}</li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<ReorderTable />);
