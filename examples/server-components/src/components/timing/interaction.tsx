"use client";
import { useEffect, useState } from "react";

export const island = "interaction";

// Says whether it has hydrated, so a test can tell when its island's code ran.
export function InteractionIsland() {
  const [hydrated, setHydrated] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => setHydrated(true), []);
  return (
    <button
      type="button"
      data-testid="interaction"
      data-hydrated={String(hydrated)}
      onClick={() => setCount(count + 1)}
    >
      {`Interaction: ${count}`}
    </button>
  );
}
