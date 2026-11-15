"use client";
import { useState, type ReactNode } from "react";
import { kinds } from "./actions";

export type Kinds = {
  panels: Map<string, ReactNode>;
  symbol: symbol;
  error: Error;
  items: Iterable<string>;
  blob: Blob;
  form: FormData;
};

// What a page's props and an action's result arrive as, in a form both renders agree on.
function describe(value: Kinds, items: string[]) {
  return [
    String(value.symbol === Symbol.for("farm.kinds")),
    String(value.error instanceof Error),
    items.join(""),
    `${value.blob.size} ${value.blob.type}`,
    String(value.form.get("name")),
  ].join(" ");
}

export function KindsView(props: Kinds) {
  // An iterator is read once, so keep its entries for later renders.
  const [items] = useState(() => [...props.items]);
  const [reply, setReply] = useState<{ text: string; panel: ReactNode } | null>(null);
  return (
    <div>
      <p data-testid="props">{describe(props, items)}</p>
      {props.panels.get("main")}
      <button
        type="button"
        onClick={async () => {
          const answer = await kinds();
          setReply({ text: describe(answer, [...answer.items]), panel: answer.panels.get("main") });
        }}
      >
        Ask
      </button>
      <p data-testid="reply">{reply?.text}</p>
      {reply?.panel}
    </div>
  );
}
