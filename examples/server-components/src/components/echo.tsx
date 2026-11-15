"use client";
import { useState } from "react";

export function Echo({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <button type="button" data-testid="echo-show" onClick={() => setShown(true)}>
        Show
      </button>
      {shown ? <p data-testid="echo-text">{text}</p> : null}
    </div>
  );
}
