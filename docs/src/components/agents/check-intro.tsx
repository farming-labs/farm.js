"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { agentCheckErrorMessage } from "../../lib/agents-check-messages";
import { AgentCheckNextSteps } from "./check-next-steps";
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
  return (
    <div ref={report} className="agent-check-report">
      <AgentCheckReportSections
        scan={scan}
        actions={
          <>
            <AgentCheckNextSteps scan={scan} />
            <button
              type="button"
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={() =>
                void runAgentCheck(scan.report.url).then((id) => {
                  if (id) window.location.assign(`/agents/check/${id}`);
                })
              }
            >
              {pending ? "Scanning…" : "Scan again"}
            </button>
            <button
              type="button"
              onClick={() => {
                resetAgentCheck();
                requestAnimationFrame(() => document.getElementById("agent-check-url")?.focus());
              }}
            >
              Check another site
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
