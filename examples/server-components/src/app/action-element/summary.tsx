"use client";
import { useState, type ReactNode } from "react";
import { summarize } from "./actions";

export function Summary() {
  const [summary, setSummary] = useState<ReactNode>(null);
  return (
    <div>
      <button type="button" onClick={async () => setSummary(await summarize())}>
        Summarize
      </button>
      {summary}
    </div>
  );
}
