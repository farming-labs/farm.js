"use client";
import { useState } from "react";

export default function LazyPanel() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" data-testid="lazy" onClick={() => setCount(count + 1)}>
      {`lazy: ${count}`}
    </button>
  );
}
