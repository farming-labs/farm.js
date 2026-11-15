import React, { useState } from "react";
import { createRoot } from "react-dom/client";

export function NestedTable() {
  const [groups, setGroups] = useState([
    {
      id: "group",
      extra: true,
      rows: Array.from({ length: 1_000 }, (_, id) => ({ id, label: `Row ${id}` })),
    },
  ]);
  return (
    <main>
      <button onClick={() => setGroups((current) => [...current])}>Refresh groups</button>
      <div>
        {groups.map((group) => (
          <section data-group={group.id} key={group.id}>
            <h2>Group</h2>
            <ul>
              <li data-before>Before</li>
              {group.rows.map((row) => (
                <li data-id={row.id} key={row.id}>
                  {row.label}
                </li>
              ))}
              <li data-after>After</li>
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

createRoot(document.body).render(<NestedTable />);
