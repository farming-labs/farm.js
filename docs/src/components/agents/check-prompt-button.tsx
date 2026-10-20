"use client";

import { Bot, Check } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentCheckReport } from "../../lib/agents-check";
import { agentFixPrompt } from "./check-fix-prompt";

/**
 * Copies a prompt that hands the report's gaps to a coding agent, most valuable first. The
 * report's main action; it needs the clipboard, so it appears once hydrated.
 */
export function AgentCheckPromptButton({ id, report }: { id: string; report: AgentCheckReport }) {
  const [ready, setReady] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (copy === "idle") return;
    const reset = setTimeout(() => setCopy("idle"), 2400);
    return () => clearTimeout(reset);
  }, [copy]);

  const Icon = copy === "copied" ? Check : Bot;
  return (
    <button
      type="button"
      className="agent-check-button"
      data-variant="primary"
      hidden={!ready}
      onClick={() =>
        navigator.clipboard
          .writeText(agentFixPrompt(report, `${window.location.origin}/agents/check/${id}`))
          .then(
            () => setCopy("copied"),
            () => setCopy("failed"),
          )
      }
    >
      <Icon aria-hidden size={14} strokeWidth={1.75} />
      <span aria-live="polite">
        {copy === "copied"
          ? "Prompt copied"
          : copy === "failed"
            ? "Couldn't copy"
            : "Copy fix prompt"}
      </span>
    </button>
  );
}
