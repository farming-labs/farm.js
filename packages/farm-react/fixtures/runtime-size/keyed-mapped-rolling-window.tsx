import { useState } from "react";
import { createRoot } from "react-dom/client";

interface Row {
  id: number;
  label: string;
}

export function MappedRollingWindowTable({ trimCount = 1 }: { trimCount?: number }) {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: "Alpha" },
    { id: 2, label: "Beta" },
  ]);
  const [nextId, setNextId] = useState(3);
  return (
    <main>
      <button
        onClick={() => {
          const first = { id: nextId, label: `Row ${nextId}` };
          const second = { id: nextId + 1, label: `Row ${nextId + 1}` };
          setNextId((value) => value + 2);
          setRows((current) => [...current.slice(trimCount), first]);
          setRows((current) =>
            current.map((row) => (row.id === first.id ? { ...row, label: "Mapped" } : row)),
          );
          setRows((current) => [...current.slice(trimCount), second]);
        }}
      >
        Roll, map, and roll
      </button>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{row.label}</li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<MappedRollingWindowTable />);
