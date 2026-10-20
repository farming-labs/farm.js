"use client";

import { ArrowRight, RotateCw } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { agentCheckErrorMessage } from "../../lib/agents-check-messages";
import { AgentCheckCopyLink } from "./check-copy-link";
import { AgentCheckPromptButton } from "./check-prompt-button";
import { AgentCheckReportSections } from "./check-report";
import { resetAgentCheck, runAgentCheck, useAgentCheck } from "./check-store";

/**
 * The check page's hero and check list until a scan comes back, then its report in their place.
 * The address bar stays /agents/check; "Scan again" and "Check another site" run here too.
 */
export function AgentCheckIntro({ children }: { children: ReactNode }) {
  const { scan, pending, error } = useAgentCheck();
  const report = useRef<HTMLDivElement>(null);

  // Start the report at the top, with focus on its heading for screen readers.
  useEffect(() => {
    if (!scan) return;
    window.scrollTo({ top: 0 });
    report.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [scan]);

  if (!scan) return children;
  const hasGaps = scan.report.checks.some(
    (check) => check.status === "fail" || check.status === "warn",
  );
  return (
    <div ref={report} className="agent-check-report">
      <AgentCheckReportSections
        scan={scan}
        actions={
          <>
            {hasGaps ? <AgentCheckPromptButton id={scan.id} report={scan.report} /> : null}
            <button
              type="button"
              className="agent-check-button"
              data-variant="secondary"
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={() =>
                void runAgentCheck(scan.report.url).then((id) => {
                  if (id) window.location.assign(`/agents/check/${id}`);
                })
              }
            >
              <RotateCw aria-hidden size={14} strokeWidth={1.75} />
              {pending ? "Scanning…" : "Scan again"}
            </button>
            <AgentCheckCopyLink
              path={`/agents/check/${scan.id}`}
              variant={hasGaps ? "secondary" : "primary"}
            />
            <button
              type="button"
              className="agent-check-button"
              data-variant="ghost"
              onClick={() => {
                resetAgentCheck();
                requestAnimationFrame(() => document.getElementById("agent-check-url")?.focus());
              }}
            >
              Check another site <ArrowRight aria-hidden size={14} />
            </button>
            <span className="agent-check-action-status" role="status" aria-live="polite">
              {error && !pending ? agentCheckErrorMessage(error) : ""}
            </span>
          </>
        }
      />
    </div>
  );
}
