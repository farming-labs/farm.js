"use client";

// This is a Client Component - it runs in the browser
// The "use client" directive marks this component (and its children)
// as requiring client-side JavaScript

import React, { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="bg-slate-800/50 rounded-xl p-6 border border-purple-700/50">
      <h3 className="text-xl font-semibold text-purple-400 mb-4">
        Interactive Counter
      </h3>
      <p className="text-slate-400 mb-4">
        This component uses <code className="text-purple-400">"use client"</code>{" "}
        because it needs useState for interactivity.
      </p>
      <div className="flex items-center gap-4">
        <button
          onClick={() => setCount((c) => c - 1)}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-semibold transition-colors"
        >
          -
        </button>
        <span className="text-4xl font-mono text-white min-w-[80px] text-center">
          {count}
        </span>
        <button
          onClick={() => setCount((c) => c + 1)}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-semibold transition-colors"
        >
          +
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-4">
        Only this component's JavaScript is sent to the client, not the entire
        page!
      </p>
    </div>
  );
}
