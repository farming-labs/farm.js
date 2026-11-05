"use client";
import { useState } from "react";

export function Badge({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" data-testid="namespace-badge" onClick={() => setCount(count + 1)}>
      {`${label} ${count}`}
    </button>
  );
}
