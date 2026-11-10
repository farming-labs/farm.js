"use client";

import { useState } from "react";

export function NamedExportCounter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" data-testid="named-export" onClick={() => setCount(count + 1)}>
      named export {count}
    </button>
  );
}
