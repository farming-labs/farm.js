"use client";

import { useEffect, useState } from "react";

/** "Copy prompt to fix" on a report. Copying needs JavaScript, so the button appears once hydrated. */
export function AgentCheckCopyPrompt({ prompt }: { prompt: string }) {
  const [ready, setReady] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (copy === "idle") return;
    const reset = setTimeout(() => setCopy("idle"), 2400);
    return () => clearTimeout(reset);
  }, [copy]);

  return (
    <button
      type="button"
      hidden={!ready}
      onClick={() =>
        navigator.clipboard.writeText(prompt).then(
          () => setCopy("copied"),
          () => setCopy("failed"),
        )
      }
    >
      {copy === "copied"
        ? "Prompt copied"
        : copy === "failed"
          ? "Copy failed"
          : "Copy prompt to fix"}
    </button>
  );
}
