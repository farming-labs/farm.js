import React, { useState } from "react";
import { createRoot } from "react-dom/client";
export function MembershipRows() {
  const [rows, _setRows] = useState([{ id: "a" }, { id: "b" }]);
  const [marked, setMarked] = useState(new Set(["a"]));
  return (
    <main>
      <ul>
        {rows.map((row) => (
          <li
            key={row.id}
            data-marked={marked.has(row.id)}
            onClick={() => setMarked(new Set([row.id]))}
          >
            {row.id}
          </li>
        ))}
      </ul>
    </main>
  );
}
createRoot(document.body).render(<MembershipRows />);
