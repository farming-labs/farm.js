"use client";

import { useState } from "react";

// A client page that hydrates as a root when it is first touched, below a server layout whose
// island also waits.
export const island = "interaction";

export default function NavClientPageA() {
  const [count, setCount] = useState(0);
  return (
    <section>
      <h1>Client page A</h1>
      <button type="button" onClick={() => setCount(count + 1)}>
        Page clicks: {count}
      </button>
    </section>
  );
}
