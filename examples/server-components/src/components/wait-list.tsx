"use client";
import { useState } from "react";

// A list both waiting pages pass whole, long enough that islands mode sends it once, by key.
export function WaitList({ entries }: { entries: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" data-testid="wait-list" onClick={() => setOpen(!open)}>
      {open ? entries.join(", ") : `${entries.length} entries`}
    </button>
  );
}
