import React, { useState } from "react";
import { createRoot } from "react-dom/client";

export function DirectCounter() {
  const [count, setCount] = useState(0);
  const doubled = count * 2;
  return (
    <button
      className={count > 0 ? "active" : "idle"}
      data-count={doubled}
      onClick={() => setCount((value) => value + 1)}
      style={{ opacity: count > 0 ? 1 : 0.5 }}
    >
      Count: {count} · doubled: {doubled}
    </button>
  );
}

createRoot(document.body).render(<DirectCounter />);
