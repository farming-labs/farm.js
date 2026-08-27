import React from "react";
import { createRoot } from "react-dom/client";

function Counter() {
  return <button>Count: 0</button>;
}

createRoot(document.body).render(<Counter />);
