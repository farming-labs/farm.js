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

interface WindowPositionTableProps {
  incoming: Row[];
}

export function WindowPositionTable({ incoming }: WindowPositionTableProps) {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: "Alpha" },
    { id: 2, label: "Beta" },
    { id: 3, label: "Gamma" },
  ]);
  return (
    <main>
      <button onClick={() => setRows((current) => current.toSpliced(1, 2, ...incoming))}>
        Replace rows
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
  <WindowPositionTable
    incoming={[
      { id: 4, label: "Delta" },
      { id: 5, label: "Epsilon" },
    ]}
  />,
);
