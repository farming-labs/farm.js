import React, { useState } from "react";
import { createRoot } from "react-dom/client";
export function IdentityRows() {
  const [rows, _setRows] = useState([{ id: "a" }, { id: "b" }]);
  const [selected, setSelected] = useState("a");
  return (
    <main>
      <ul>
        {rows.map((row) => (
          <li key={row.id} data-selected={selected === row.id} onClick={() => setSelected(row.id)}>
            {row.id}
          </li>
        ))}
      </ul>
    </main>
  );
}
createRoot(document.body).render(<IdentityRows />);
