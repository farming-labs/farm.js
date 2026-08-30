import { useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Array<T> {
    toSpliced(start: number, deleteCount: number, ...items: T[]): T[];
  }
}

interface Row {
  id: number;
  label: string;
}

interface BatchPositionTableProps {
  incoming: Row[];
}

export function BatchPositionTable({ incoming }: BatchPositionTableProps) {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: "Alpha" },
    { id: 2, label: "Beta" },
  ]);
  return (
    <main>
      <button onClick={() => setRows((current) => current.toSpliced(1, 0, ...incoming))}>
        Insert rows
      </button>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{row.label}</li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(
  <BatchPositionTable
    incoming={[
      { id: 3, label: "Gamma" },
      { id: 4, label: "Delta" },
    ]}
  />,
);
