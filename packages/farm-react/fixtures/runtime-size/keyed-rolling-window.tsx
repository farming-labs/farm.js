import { useState } from "react";
import { createRoot } from "react-dom/client";

interface Row {
  id: number;
  label: string;
}

export function RollingWindowTable({ trimCount = 1 }: { trimCount?: number }) {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: "Alpha" },
    { id: 2, label: "Beta" },
  ]);
  const [nextId, setNextId] = useState(3);
  return (
    <main>
      <button
        onClick={() => {
          const incoming = { id: nextId, label: `Row ${nextId}` };
          setNextId((value) => value + 1);
          setRows((current) => [...current.slice(trimCount), incoming]);
        }}
      >
        Roll window
      </button>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{row.label}</li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<RollingWindowTable />);
