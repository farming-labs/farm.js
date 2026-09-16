"use client";
import { useState } from "react";

export const island = "load";

export function ListItemIsland({ name }: { name: string }) {
  const [count, setCount] = useState(0);
  return (
    <li>
      <button
        type="button"
        data-testid={`list-item-${name}`}
        onClick={() => setCount(count + 1)}
      >
        {name}: {count}
      </button>
    </li>
  );
}
