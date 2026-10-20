"use client";

import { Check, Link2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * "Copy link" on a report: `path`, or the address bar. Copying needs JavaScript, so the button
 * appears once hydrated.
 */
export function AgentCheckCopyLink({
  path,
  variant = "secondary",
}: {
  path?: string;
  variant?: "primary" | "secondary";
}) {
  const [ready, setReady] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (copy === "idle") return;
    const reset = setTimeout(() => setCopy("idle"), 2400);
    return () => clearTimeout(reset);
  }, [copy]);

  const Icon = copy === "copied" ? Check : Link2;
  return (
    <button
      type="button"
      className="agent-check-button"
      data-variant={variant}
      hidden={!ready}
      onClick={() =>
        navigator.clipboard
          .writeText(path ? `${window.location.origin}${path}` : window.location.href)
          .then(
            () => setCopy("copied"),
            () => setCopy("failed"),
          )
      }
    >
      <Icon aria-hidden size={14} strokeWidth={1.75} />
      <span aria-live="polite">
        {copy === "copied"
          ? "Link copied"
          : copy === "failed"
            ? "Copy the address bar"
            : "Copy link"}
      </span>
    </button>
  );
}
