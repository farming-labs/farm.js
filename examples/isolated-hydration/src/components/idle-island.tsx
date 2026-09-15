"use client";
import { useState } from "react";

export const island = "idle";

export function IdleIsland() {
  const [clicked, setClicked] = useState(false);
  return (
    <button type="button" data-testid="idle" onClick={() => setClicked(true)}>
      {clicked ? "idle: clicked" : "idle: ready"}
    </button>
  );
}
