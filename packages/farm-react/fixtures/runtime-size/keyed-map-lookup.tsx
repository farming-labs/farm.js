import React, { useState } from "react";
import { createRoot } from "react-dom/client";
export function LookupRows() {
  const [rows, _setRows] = useState([{ id: "a" }, { id: "b" }]);
  const [lookup, setLookup] = useState(new Map([["a", "ready"]]));
  return (
    <main>
      <ul>
        {rows.map((row) => (
          <li
            key={row.id}
            data-value={lookup.get(row.id)}
            onClick={() => setLookup(new Map([[row.id, "ready"]]))}
          >
            {row.id}
          </li>
        ))}
      </ul>
    </main>
  );
}
createRoot(document.body).render(<LookupRows />);
