"use client";

import React, { useState } from "react";

export function StarButton({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  return (
    <button type="button" data-testid="star-button" onClick={() => setCount(count + 1)}>
      Stars: {count}
    </button>
  );
}
