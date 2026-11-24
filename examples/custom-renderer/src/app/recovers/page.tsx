"use client";

import { useState } from "leaf";

// A test fixture: the first render in the browser throws, so hydrating the server's markup fails
// and Farm renders the route in the browser instead. Later renders work.
let browserRenders = 0;

export default function RecoversPage() {
  const [count, setCount] = useState(0);
  if (typeof window !== "undefined" && browserRenders++ === 0) {
    throw new Error("The first browser render of /recovers threw.");
  }
  return (
    <section>
      <h1>This page recovers from a failed hydration</h1>
      <button type="button" id="recovers-counter" onClick={() => setCount((n) => n + 1)}>
        Clicked {count} times
      </button>
    </section>
  );
}
