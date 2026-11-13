"use client";
import { use, useEffect, useState } from "react";
import { touch } from "./actions";

export function LaterNote({ note }: { note: Promise<string> }) {
  const [touched, setTouched] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <div>
      <p data-testid="note">{use(note)}</p>
      <button
        type="button"
        data-hydrated={String(hydrated)}
        onClick={async () => {
          await touch();
          setTouched(true);
        }}
      >
        Touch
      </button>
      <p data-testid="touched">{touched ? "touched" : ""}</p>
    </div>
  );
}
