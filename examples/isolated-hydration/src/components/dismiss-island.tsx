"use client";
import { useState } from "react";

export const island = "interaction";

export function DismissIsland({ label }: { label: string }) {
  const [dismissed, setDismissed] = useState(false);
  return (
    <button type="button" data-testid="dismiss" onClick={() => setDismissed(true)}>
      {dismissed ? "dismissed" : label}
    </button>
  );
}
