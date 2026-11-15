import React, { useState } from "react";
import { createRoot } from "react-dom/client";

export function SelectableRows() {
  const [rows, setRows] = useState([{ id: "a" }, { id: "b" }]);
  const [selected, setSelected] = useState("a");
  return (
    <main>
      <ul>
        {rows.map((row) => (
          <li key={row.id} data-selected={selected === row.id}>
            <button onClick={() => setSelected(row.id)}>Select {row.id}</button>
            <button
              onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.body).render(<SelectableRows />);
