"use client";
import { useState } from "react";

export function Counter({ start, label = "Count" }: { start: number; label?: string }) {
  const [count, setCount] = useState(start);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {`${label}: ${count}`}
    </button>
  );
}
