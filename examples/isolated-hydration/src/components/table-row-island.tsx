"use client";
import { useState } from "react";

export const island = "load";

export function TableRowIsland() {
  const [selected, setSelected] = useState(false);
  return (
    <tr data-testid="table-row" data-selected={selected ? "yes" : "no"}>
      <td>
        <button type="button" data-testid="table-button" onClick={() => setSelected(true)}>
          {selected ? "row selected" : "select row"}
        </button>
      </td>
    </tr>
  );
}
