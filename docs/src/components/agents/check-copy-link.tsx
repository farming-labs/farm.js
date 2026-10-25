"use client";

import { useEffect, useState } from "react";

/**
 * "Copy link" on a report: the check page for its site, which runs the check again when opened.
 * Copying needs JavaScript, so the button appears once hydrated.
 */
export function AgentCheckCopyLink({ path }: { path: string }) {
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
        navigator.clipboard.writeText(new URL(path, window.location.origin).href).then(
          () => setCopy("copied"),
          () => setCopy("failed"),
        )
      }
    >
      {copy === "copied" ? "Link copied" : copy === "failed" ? "Copy the address bar" : "Copy link"}
    </button>
  );
}
