import { useState } from "react";
import { createRoot } from "react-dom/client";

interface Row {
  id: number;
  label: string;
  rank: number;
}

export function MapReorderTable() {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: "Alpha", rank: 1 },
    { id: 2, label: "Beta", rank: 2 },
  ]);
  return (
    <main>
      <button
        onClick={() =>
          setRows((current) =>
            current
              .map((row) => (row.id === 1 ? { ...row, rank: 3 } : row))
              .toSorted((left, right) => left.rank - right.rank),
          )
        }
      >
        Edit and sort
      </button>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            {row.label}: {row.rank}
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<MapReorderTable />);
