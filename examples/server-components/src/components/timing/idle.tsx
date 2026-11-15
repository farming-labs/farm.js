"use client";
import { useEffect, useState } from "react";

export const island = "idle";

// Says whether it has hydrated, so a test can tell when its island's code ran.
export function IdleIsland() {
  const [hydrated, setHydrated] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => setHydrated(true), []);
  return (
    <button
      type="button"
      data-testid="idle"
      data-hydrated={String(hydrated)}
      onClick={() => setCount(count + 1)}
    >
      {`Idle: ${count}`}
    </button>
  );
}
