"use client";

import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={() => setCount((c) => c - 1)}
        className="h-9 w-9 rounded-md border border-white/15 text-lg transition hover:bg-white/10"
      >
        −
      </button>
      <span className="min-w-12 text-center font-mono text-2xl">{count}</span>
      <button
        onClick={() => setCount((c) => c + 1)}
        className="h-9 w-9 rounded-md border border-white/15 text-lg transition hover:bg-white/10"
      >
        +
      </button>
    </div>
  );
}
