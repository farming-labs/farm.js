"use client";

import { Link } from "@farm.js/core/client";
import { useState } from "react";

export default function SlotLabPage() {
  const [count, setCount] = useState(0);

  return (
    <section className="grid gap-4">
      <p data-testid="slot-background">Persistent slot background</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Background count: {count}
      </button>
      <Link href="/slot-lab/photo/42" data-testid="open-intercepted-photo">
        Open photo 42
      </Link>
    </section>
  );
}
