"use client";

import { useEffect, useState } from "react";

/** "Copy link" on a report. Copying needs JavaScript, so the button appears once hydrated. */
export function AgentCheckCopyLink() {
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
        navigator.clipboard.writeText(window.location.href).then(
          () => setCopy("copied"),
          () => setCopy("failed"),
        )
      }
    >
      {copy === "copied" ? "Link copied" : copy === "failed" ? "Copy the address bar" : "Copy link"}
    </button>
  );
}
