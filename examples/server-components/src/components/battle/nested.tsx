"use client";
import { useState, type ReactNode } from "react";

function Inner() {
  const [on, setOn] = useState(false);
  return (
    <button type="button" onClick={() => setOn(!on)}>
      {on ? "inner on" : "inner off"}
    </button>
  );
}

export function Outer({ children }: { children?: ReactNode }) {
  const [count, setCount] = useState(0);
  return (
    <div data-testid="outer">
      <button type="button" onClick={() => setCount(count + 1)}>
        {`outer ${count}`}
      </button>
      <Inner />
      <div data-testid="outer-children">{children}</div>
    </div>
  );
}
