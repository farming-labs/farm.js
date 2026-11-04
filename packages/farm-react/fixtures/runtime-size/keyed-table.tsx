import React, { useState } from "react";
import { createRoot } from "react-dom/client";

interface Row {
  id: number;
  label: string;
}

let nextId = 1;
function rows(count: number): Row[] {
  return Array.from({ length: count }, () => {
    const id = nextId++;
    return { id, label: `Row ${id}` };
  });
}

export function KeyedTable() {
  const [data, setData] = useState<Row[]>([]);
  const [selected, setSelected] = useState(0);
  return (
    <main>
      <button id="create" onClick={() => setData(rows(1_000))}>
        Create
      </button>
      <button id="append" onClick={() => setData((current) => current.concat(rows(1_000)))}>
        Append
      </button>
      <button
        id="update"
        onClick={() =>
          setData((current) =>
            current.map((row, index) =>
              index % 10 === 0 ? { id: row.id, label: `${row.label}!` } : row,
            ),
          )
        }
      >
        Update
      </button>
      <button
        id="swap"
        onClick={() =>
          setData((current) => {
            if (current.length < 999) return current;
            const next = current.slice();
            const second = next[1];
            next[1] = next[998];
            next[998] = second;
            return next;
          })
        }
      >
        Swap
      </button>
      <button
        id="clear"
        onClick={() => {
          setData([]);
          setSelected(0);
        }}
      >
        Clear
      </button>
      <table>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} data-id={row.id} className={selected === row.id ? "selected" : ""}>
              <td>{row.id}</td>
              <td>
                <button data-select onClick={() => setSelected(row.id)}>
                  {row.label}
                </button>
              </td>
              <td>
                <button
                  data-remove
                  onClick={() => setData((current) => current.filter((item) => item.id !== row.id))}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

createRoot(document.body).render(<KeyedTable />);
