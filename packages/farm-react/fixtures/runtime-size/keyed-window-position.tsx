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
  first: Row[];
  second: Row[];
}

export function WindowPositionTable({ first, second }: WindowPositionTableProps) {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: "Alpha" },
    { id: 2, label: "Beta" },
    { id: 3, label: "Gamma" },
  ]);
  return (
    <main>
      <button
        onClick={() => {
          setRows((current) => current.toSpliced(1, 1, ...first));
          setRows((current) => current.toSpliced(2, 1, ...second));
        }}
      >
        Refresh queued windows
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
  <WindowPositionTable first={[{ id: 5, label: "Epsilon" }]} second={[{ id: 6, label: "Phi" }]} />,
);
