"use client";

import { useState } from "react";

export default function NavigationLoadingCounter({ label }: { label: string }) {
  const [count, setCount] = useState(0);

  return (
    <button
      type="button"
      data-testid="navigation-loading-counter"
      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
      onClick={() => setCount((value) => value + 1)}
    >
      {label} clicks: {count}
    </button>
  );
}
