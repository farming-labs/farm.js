"use client";

import { useEffect, useState } from "react";

/** "Copy prompt to fix" on a report. Copying needs JavaScript, so the button appears once hydrated. */
export function AgentCheckCopyPrompt({ prompt }: { prompt: string }) {
  return <AgentCheckCopyText text={prompt} label="Copy prompt to fix" copied="Prompt copied" />;
}

/** A button that copies `text`, shown once hydrated. */
export function AgentCheckCopyText({
  text,
  label,
  copied,
}: {
  text: string;
  label: string;
  copied: string;
}) {
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
        navigator.clipboard.writeText(text).then(
          () => setCopy("copied"),
          () => setCopy("failed"),
        )
      }
    >
      {copy === "copied" ? copied : copy === "failed" ? "Copy failed" : label}
    </button>
  );
}
