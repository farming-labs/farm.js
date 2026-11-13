"use client";
import { use, useState } from "react";
import { touch } from "./actions";

export function LaterNote({ note }: { note: Promise<string> }) {
  const [touched, setTouched] = useState(false);
  return (
    <div>
      <p data-testid="note">{use(note)}</p>
      <button
        type="button"
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
