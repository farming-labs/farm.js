import { useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Array<T> {
    toSorted(compare?: (left: T, right: T) => number): T[];
  }
}

interface Row {
  id: number;
  label: string;
  rank: number;
}

export function SortTable() {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: "Alpha", rank: 2 },
    { id: 2, label: "Beta", rank: 1 },
  ]);
  return (
    <main>
      <button
        onClick={() =>
          setRows((current) => current.toSorted((left, right) => left.rank - right.rank))
        }
      >
        Sort rows
      </button>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{row.label}</li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<SortTable />);
