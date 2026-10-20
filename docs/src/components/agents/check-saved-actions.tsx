"use client";

import { ArrowRight, RotateCw } from "lucide-react";
import type { AgentCheckReport } from "../../lib/agents-check";
import { AgentCheckCopyLink } from "./check-copy-link";
import { AgentCheckPromptButton } from "./check-prompt-button";

/** The button row on a saved report, at /agents/check/[id]. */
export function AgentCheckSavedActions({ id, report }: { id: string; report: AgentCheckReport }) {
  const hasGaps = report.checks.some((check) => check.status === "fail" || check.status === "warn");
  return (
    <>
      {hasGaps ? <AgentCheckPromptButton id={id} report={report} /> : null}
      <a
        className="agent-check-button"
        data-variant="secondary"
        href={`/agents/check?url=${encodeURIComponent(report.url)}`}
      >
        <RotateCw aria-hidden size={14} strokeWidth={1.75} />
        Scan again
      </a>
      <AgentCheckCopyLink variant={hasGaps ? "secondary" : "primary"} />
      <a className="agent-check-button" data-variant="ghost" href="/agents/check">
        Check another site <ArrowRight aria-hidden size={14} />
      </a>
    </>
  );
}
