"use client";
import { use, useState, type ReactNode } from "react";
import { reveal } from "../../app/wire/promise-element/actions";

// Shows server output that arrives through a promise: a prop, and an action's result.
export function Reveal({ content }: { content: Promise<ReactNode> }) {
  const [revealed, setRevealed] = useState<ReactNode>(null);
  return (
    <div>
      <div data-testid="promised">{use(content)}</div>
      <button
        type="button"
        onClick={async () => {
          const result = await reveal();
          setRevealed(await result.later);
        }}
      >
        Reveal
      </button>
      <div data-testid="revealed">{revealed}</div>
    </div>
  );
}
