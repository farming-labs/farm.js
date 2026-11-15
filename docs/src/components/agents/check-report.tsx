import type { ReactNode } from "react";
import { ChevronDown, ScanSearch } from "lucide-react";
import type {
  AgentCheckReport,
  AgentCheckResult,
  AgentCheckStatus,
  StoredAgentCheck,
} from "../../lib/agents-check";
import { IndexedLabel } from "../site-chrome";
import { AgentCheckMadeWith } from "./check-made-with";
import { AGENT_CHECK_ICONS } from "./check-icons";

/**
 * A finished agent-ready check: score, gaps, passing and unscored checks. Rendered by the
 * check page in place of its intro once a scan comes back. `actions` fills the button row
 * under the score.
 */
export function hostOf(report: AgentCheckReport): string {
  return new URL(report.finalUrl).host;
}

export function verdict(score: number): string {
  if (score >= 90) return "Agents can read and use this site.";
  if (score >= 70) return "Agents can read this site, with gaps.";
  if (score >= 40) return "Agents will struggle with this site.";
  return "Agents mostly can't use this site.";
}

const STATUS_LABEL: Record<AgentCheckStatus, string> = {
  pass: "Pass",
  warn: "Partial",
  fail: "Missing",
  info: "Not scored",
};

/** Points a check gives up: all of them when it fails, half when it is partial. */
function pointsLost(check: AgentCheckResult): number {
  if (check.status === "fail") return check.weight;
  if (check.status === "warn") return check.weight / 2;
  return 0;
}

function StatusTag({ check }: { check: AgentCheckResult }) {
  return (
    <span className="agent-check-status" data-status={check.status}>
      {STATUS_LABEL[check.status]}
      {check.weight ? ` · ${check.weight} pts` : ""}
    </span>
  );
}

function Evidence({ lines, collapsed = false }: { lines: string[]; collapsed?: boolean }) {
  if (!lines.length) return null;
  const list = (
    <ul className="agent-check-evidence" aria-label="Evidence">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
  if (!collapsed) return list;
  return (
    <details className="agent-check-saw">
      <summary>What the check saw</summary>
      {list}
    </details>
  );
}

function CheckRows({ checks }: { checks: AgentCheckResult[] }) {
  return (
    <ol className="agent-check-rows farm-full-rule">
      {checks.map((check, index) => (
        <li key={check.id}>
          <details>
            <summary>
              <IndexedLabel
                index={String(index + 1).padStart(2, "0")}
                icon={AGENT_CHECK_ICONS[check.id]}
                label={check.title}
              />
              <span className="agent-check-row-summary">{check.summary}</span>
              <span className="agent-check-row-end">
                <StatusTag check={check} />
                <ChevronDown className="agent-check-row-chevron" size={14} aria-hidden />
              </span>
            </summary>
            <Evidence lines={check.evidence} />
          </details>
        </li>
      ))}
    </ol>
  );
}

export function AgentCheckReportSections({
  scan,
  actions,
}: {
  scan: StoredAgentCheck;
  actions: ReactNode;
}) {
  const { report } = scan;
  const host = hostOf(report);
  const filled = Math.round(report.score / 5);
  const gaps = report.checks
    .filter((check) => check.status === "fail" || check.status === "warn")
    .sort((a, b) => pointsLost(b) - pointsLost(a));
  const passing = report.checks.filter((check) => check.status === "pass" && check.weight > 0);
  const unscored = report.checks.filter((check) => check.weight === 0);
  const scannedAt = new Date(scan.createdAt).toISOString().slice(0, 16).replace("T", " ");

  return (
    <>
      <section className="agent-check-hero farm-full-rule" aria-labelledby="agent-check-host">
        <div className="agent-check-hero-top">
          <IndexedLabel index="06.4" icon={ScanSearch} label="Agent-ready check" />
        </div>
        <div className="agent-check-hero-body">
          <div className="min-w-0">
            <div className="agent-check-host">
              <h1 id="agent-check-host" tabIndex={-1}>
                {host}
              </h1>
              <AgentCheckMadeWith report={report} />
            </div>
            <p className="agent-check-verdict">{verdict(report.score)}</p>
            <p className="agent-check-meta">
              {report.finalUrl} · {scannedAt} UTC · {(report.durationMs / 1000).toFixed(1)}s
            </p>
          </div>
          <p
            className="agent-check-score font-geist-pixel"
            aria-label={`Score ${report.score} out of 100`}
          >
            {report.score}
            <span>/100</span>
          </p>
        </div>
        <div className="agent-check-meter" aria-hidden>
          {Array.from({ length: 20 }, (_, index) => (
            <span key={index} data-on={index < filled ? "" : undefined} />
          ))}
        </div>
        <div className="agent-check-actions">{actions}</div>
      </section>

      {gaps.length > 0 ? (
        <section aria-labelledby="agent-check-gaps-title">
          <div className="agents-section-heading farm-full-rule">
            <div>
              <IndexedLabel index="01" label="To fix" />
              <h2 id="agent-check-gaps-title" className="font-geist-pixel">
                {gaps.length} {gaps.length === 1 ? "gap" : "gaps"}
                <br />
                agents hit.
              </h2>
            </div>
            <p>
              Ordered by the points each one costs; a partial result earns half. Each says what's
              missing and how to add it.
            </p>
          </div>
          <div className="agents-now agent-check-gaps farm-full-rule">
            {gaps.map((check, index) => (
              <article key={check.id}>
                <div className="agents-now-top">
                  <IndexedLabel
                    index={String(index + 1).padStart(2, "0")}
                    icon={AGENT_CHECK_ICONS[check.id]}
                    label={check.title}
                  />
                  <StatusTag check={check} />
                </div>
                <h3 className="font-geist-pixel">{check.summary}</h3>
                {check.fix ? <p className="agent-check-fix">{check.fix.summary}</p> : null}
                <Evidence lines={check.evidence} collapsed />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {passing.length > 0 ? (
        <section aria-labelledby="agent-check-passing-title">
          <div className="agent-check-rows-heading farm-full-rule">
            <IndexedLabel index={gaps.length ? "02" : "01"} label="Passing" />
            <h2 id="agent-check-passing-title" className="sr-only">
              Passing checks
            </h2>
            <span>{passing.length}</span>
          </div>
          <CheckRows checks={passing} />
        </section>
      ) : null}

      {unscored.length > 0 ? (
        <section aria-labelledby="agent-check-unscored-title">
          <div className="agent-check-rows-heading farm-full-rule">
            <IndexedLabel index={gaps.length ? "03" : "02"} label="Reported, not scored" />
            <h2 id="agent-check-unscored-title" className="sr-only">
              Checks that are reported but not scored
            </h2>
            <span>{unscored.length}</span>
          </div>
          <CheckRows checks={unscored} />
        </section>
      ) : null}
    </>
  );
}
