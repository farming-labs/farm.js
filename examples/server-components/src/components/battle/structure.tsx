"use client";
import { useState } from "react";

export function ClientItem({ label }: { label: string }) {
  const [done, setDone] = useState(false);
  return (
    <li>
      <button type="button" data-testid={`item-${label}`} onClick={() => setDone(!done)}>
        {`${label} ${done ? "done" : "open"}`}
      </button>
    </li>
  );
}

export function ClientRow({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        <button type="button" data-testid={`row-${label}`} onClick={() => setCount(count + 1)}>
          {`${label} ${count}`}
        </button>
      </td>
    </tr>
  );
}

export function ClientOption({ value }: { value: string }) {
  return <option value={value}>{value}</option>;
}

export function ClientShape() {
  const [big, setBig] = useState(false);
  return (
    <circle
      data-testid="shape"
      cx="10"
      cy="10"
      r={big ? 8 : 4}
      onClick={() => setBig(!big)}
      style={{ cursor: "pointer" }}
    />
  );
}
