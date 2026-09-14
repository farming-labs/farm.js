"use client";

import { useState } from "react";

// Open DevTools > Inspect to compare this TSX with Vite's served JavaScript.
export function Counter() {
  const [count, setCount] = useState(0);
  return <button type="button" onClick={() => setCount(value => value + 1)}>Count: {count}</button>;
}
