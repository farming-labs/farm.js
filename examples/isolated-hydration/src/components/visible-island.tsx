"use client";
import { useState } from "react";

export const island = "visible";

export function VisibleIsland() {
  const [clicked, setClicked] = useState(false);
  return (
    <button type="button" data-testid="visible" onClick={() => setClicked(true)}>
      {clicked ? "visible: clicked" : "visible: ready"}
    </button>
  );
}
