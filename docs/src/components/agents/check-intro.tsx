"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSearchParams } from "@farm.js/core/navigation";
import type { StoredAgentCheck } from "../../lib/agents-check";
import { agentCheckErrorMessage, agentCheckPath } from "../../lib/agents-check-messages";
import { AgentCheckCopyLink } from "./check-copy-link";
import { AgentCheckNextSteps } from "./check-next-steps";
import { AgentCheckReportSections } from "./check-report";
import { resetAgentCheck, runAgentCheck, showAgentCheck, useAgentCheck } from "./check-store";

/** Whether this page was loaded by going back or forward to it, where its report was shown. */
function isHistoryVisit(): boolean {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "back_forward" && entry.name === window.location.href;
}

/**
 * The check page's hero and check list until a scan comes back, then its report in their place.
 * Everything runs here at /agents/check?url=<site>: opening that link runs the check once, and
 * "Scan again" and "Check another site" stay on the page. `initialScan` is a report the server
 * rendered for a form post without JavaScript.
 */
export function AgentCheckIntro({
  children,
  initialScan,
}: {
  children: ReactNode;
  initialScan?: StoredAgentCheck;
}) {
  const check = useAgentCheck();
  const { pending, error } = check;
  const search = useSearchParams();
  const linked = search.get("url")?.trim().slice(0, 2048);
  const linkError = search.get("error");
  // Until the store holds the server's report, render that one so hydration matches.
  const [seeded, setSeeded] = useState(!initialScan);
  const scan = seeded ? check.scan : (initialScan ?? null);
  const report = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialScan) {
      showAgentCheck(initialScan);
      setSeeded(true);
      return;
    }
    // A shared link runs its check once. Not when this page already shows that site (client
    // navigation back keeps the report), on a history visit, or after a form post's `?error=`.
    const shown = check.scan?.report.url;
    if (linked && !linkError && !check.pending && shown !== linked && !isHistoryVisit()) {
      void runAgentCheck(linked);
    }
    // Runs on mount only: later runs come from the form and the report's buttons.
  }, []);

  // Start the report at the top, with focus on its heading for screen readers.
  useEffect(() => {
    if (!scan || scan === initialScan) return;
    window.scrollTo({ top: 0 });
    report.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [scan, initialScan]);

  if (!scan) return children;
  return (
    <div ref={report} className="agent-check-report">
      {/* "Scan again" posts this form when the page has no JavaScript. */}
      <form
        id="agent-check-rescan"
        hidden
        action="/api/agents/check"
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          void runAgentCheck(scan.report.url);
        }}
      >
        <input type="hidden" name="url" value={scan.report.url} />
      </form>
      <AgentCheckReportSections
        scan={scan}
        actions={
          <>
            <AgentCheckNextSteps scan={scan} />
            <div
              className="agent-check-action-group"
              data-quiet=""
              role="group"
              aria-label="Report"
            >
              <AgentCheckCopyLink path={agentCheckPath(scan.report.url)} />
              <button
                type="submit"
                form="agent-check-rescan"
                disabled={pending}
                aria-busy={pending || undefined}
              >
                {pending ? "Scanning…" : "Scan again"}
              </button>
              <a
                href="/agents/check"
                onClick={(event) => {
                  event.preventDefault();
                  resetAgentCheck();
                  requestAnimationFrame(() => document.getElementById("agent-check-url")?.focus());
                }}
              >
                Check another site
              </a>
              <span className="agent-check-action-status" role="status" aria-live="polite">
                {error && !pending ? agentCheckErrorMessage(error) : ""}
              </span>
            </div>
          </>
        }
      />
    </div>
  );
}
