"use client";
import { useState } from "react";

export const island = "load";

export function SvgIsland() {
  const [active, setActive] = useState(false);
  return (
    <circle
      data-testid="svg-circle"
      cx="50"
      cy="50"
      r={active ? 40 : 20}
      fill={active ? "green" : "gray"}
      onClick={() => setActive(true)}
    />
  );
}
