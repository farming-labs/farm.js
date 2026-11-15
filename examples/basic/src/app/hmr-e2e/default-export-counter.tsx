"use client";

import { useState } from "react";

export default function DefaultExportCounter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" data-testid="default-export" onClick={() => setCount(count + 1)}>
      default export {count}
    </button>
  );
}
