"use client";
import { useEffect, useState } from "react";

export const island = "visible";

// Says whether it has hydrated, so a test can tell when its island's code ran.
export function VisibleIsland() {
  const [hydrated, setHydrated] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => setHydrated(true), []);
  return (
    <button
      type="button"
      data-testid="visible"
      data-hydrated={String(hydrated)}
      onClick={() => setCount(count + 1)}
    >
      {`Visible: ${count}`}
    </button>
  );
}
