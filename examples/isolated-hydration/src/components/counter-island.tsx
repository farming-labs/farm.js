"use client";
import { useState } from "react";

export const island = "load";

export function CounterIsland({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  return (
    <button type="button" data-testid="counter" onClick={() => setCount(count + 1)}>
      count: {count}
    </button>
  );
}
