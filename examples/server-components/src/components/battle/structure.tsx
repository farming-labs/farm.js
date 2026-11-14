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
