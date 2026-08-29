import { useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Array<T> {
    with(index: number, item: T): T[];
  }
}

interface Row {
  id: number;
  label: string;
}

interface PositionTableProps {
  replacement: Row;
}

export function PositionTable({ replacement }: PositionTableProps) {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: "Alpha" },
    { id: 2, label: "Beta" },
  ]);
  return (
    <main>
      <button onClick={() => setRows((current) => current.with(0, replacement))}>
        Replace first row
      </button>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{row.label}</li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<PositionTable replacement={{ id: 1, label: "Updated" }} />);
