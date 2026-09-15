"use client";
import { useState } from "react";

export const island = "load";

export function OptionIsland() {
  const [extra, setExtra] = useState(false);
  return (
    <>
      <option value="alpha" data-testid="option-alpha">
        {extra ? "alpha (hydrated)" : "alpha"}
      </option>
      {extra ? <option value="beta">beta</option> : null}
      <option value="trigger" data-testid="option-trigger" onClick={() => setExtra(true)}>
        trigger
      </option>
    </>
  );
}
