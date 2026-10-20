import type { ReactNode } from "react";
import { ArrowUpRight, Check, ChevronDown, Copy, ScanSearch } from "lucide-react";
import type {
  AgentCheckReport,
  AgentCheckResult,
  AgentCheckStatus,
  StoredAgentCheck,
} from "../../lib/agents-check";
import { IndexedLabel } from "../site-chrome";
import { AgentCheckClipboard } from "./check-clipboard";
import { formatPoints, groupChecks, pointsLost } from "./check-groups";
import { AGENT_CHECK_ICONS } from "./check-icons";
import { AgentCheckSavedActions } from "./check-saved-actions";

/**
 * A finished agent-ready check: the score, where its points come from, the gaps to fix first,
 * and every check behind it. Rendered by the check page once a scan comes back, with its own
 * `actions`, and by /agents/check/[id] for saved links, which gets the saved report's buttons.
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

function StatusTag({ status }: { status: AgentCheckStatus }) {
  return (
    <span className="agent-check-status" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** The score as a ring, in the page's pixel face. */
function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="agent-check-ring" role="img" aria-label={`Score ${score} out of 100`}>
      <svg viewBox="0 0 128 128" aria-hidden>
        <circle cx="64" cy="64" r={radius} className="agent-check-ring-track" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          className="agent-check-ring-value"
          strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
          data-band={score >= 90 ? "high" : score >= 70 ? "mid" : "low"}
        />
      </svg>
      <p aria-hidden data-digits={String(score).length}>
        <span className="font-geist-pixel">{score}</span>
        <small>/100</small>
      </p>
    </div>
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

/** The config that closes a gap in a Farm.js app. Open on Farm.js sites, a hint on others. */
function FarmSnippet({
  fix,
  farm,
}: {
  fix: NonNullable<NonNullable<AgentCheckResult["fix"]>["farm"]>;
  farm: boolean;
}) {
  const block = (
    <div className="agent-check-snippet">
      <div className="agent-check-snippet-head">
        <code>{fix.file}</code>
        <button
          type="button"
          className="agent-check-copy-code"
          data-agent-check-copy={fix.code}
          aria-label="Copy the snippet"
          hidden
        >
          <Copy aria-hidden size={13} strokeWidth={1.75} />
          <Check aria-hidden size={13} strokeWidth={1.75} />
          <span data-label="idle">Copy</span>
          <span data-label="done">Copied</span>
        </button>
      </div>
      <pre>
        <code>{fix.code}</code>
      </pre>
    </div>
  );
  if (farm) return block;
  return (
    <details className="agent-check-saw">
      <summary>In a Farm.js app</summary>
      {block}
    </details>
  );
}

function CheckRows({ checks }: { checks: AgentCheckResult[] }) {
  return (
    <ul className="agent-check-rows">
      {checks.map((check) => {
        const Icon = AGENT_CHECK_ICONS[check.id];
        return (
          <li key={check.id}>
            <details>
              <summary>
                <span className="agent-check-row-title">
                  {Icon ? <Icon aria-hidden size={14} strokeWidth={1.5} /> : null}
                  {check.title}
                </span>
                <span className="agent-check-row-summary">{check.summary}</span>
                <span className="agent-check-row-end">
                  <StatusTag status={check.status} />
                  <span className="agent-check-row-points">
                    {check.weight
                      ? `${formatPoints(check.weight - pointsLost(check))}/${check.weight}`
                      : "—"}
                  </span>
                  <ChevronDown className="agent-check-row-chevron" size={14} aria-hidden />
                </span>
              </summary>
              <Evidence lines={check.evidence} />
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export function AgentCheckReportSections({
  scan,
  actions,
}: {
  scan: StoredAgentCheck;
  actions?: ReactNode;
}) {
  const { report } = scan;
  const host = hostOf(report);
  const gaps = report.checks
    .filter((check) => check.status === "fail" || check.status === "warn")
    .sort((a, b) => pointsLost(b) - pointsLost(a));
  const passing = report.checks.filter((check) => check.status === "pass" && check.weight > 0);
  const reported = report.checks.filter((check) => check.weight === 0);
  const { groups, other } = groupChecks(report.checks);
  const scannedAt = new Date(scan.createdAt).toISOString().slice(0, 16).replace("T", " ");

  return (
    <>
      <AgentCheckClipboard />
      <section className="agent-check-hero farm-full-rule" aria-labelledby="agent-check-host">
        <div className="agent-check-hero-top">
          <IndexedLabel index="06.4" icon={ScanSearch} label="Agent-ready check" />
          {report.farm ? (
            <span className="agent-check-chip" data-tone="pass">
              Built with Farm.js
            </span>
          ) : null}
        </div>
        <div className="agent-check-hero-body">
          <div className="agent-check-hero-copy">
            <h1 id="agent-check-host" tabIndex={-1}>
              {host}
            </h1>
            <p className="agent-check-verdict">{verdict(report.score)}</p>
            <p className="agent-check-meta">
              <span>{report.finalUrl}</span>
              <span>{scannedAt} UTC</span>
              <span>{(report.durationMs / 1000).toFixed(1)}s</span>
            </p>
            <div className="agent-check-actions">
              {actions ?? <AgentCheckSavedActions id={scan.id} report={report} />}
            </div>
          </div>
          <div className="agent-check-hero-score">
            <ScoreRing score={report.score} />
            <dl className="agent-check-tally">
              <div>
                <dt>To fix</dt>
                <dd>{gaps.length}</dd>
              </div>
              <div>
                <dt>Passing</dt>
                <dd>{passing.length}</dd>
              </div>
              <div>
                <dt>Reported</dt>
                <dd>{reported.length}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section aria-labelledby="agent-check-breakdown-title">
        <h2 id="agent-check-breakdown-title" className="sr-only">
          Where the points come from
        </h2>
        <ol className="agent-check-groups farm-full-rule">
          {groups.map((group, index) => (
            <li key={group.id} className="agent-check-group-card">
              <div className="agent-check-group-top">
                <IndexedLabel
                  index={String(index + 1).padStart(2, "0")}
                  icon={group.icon}
                  label={group.label}
                />
                <span className="agent-check-group-passed">
                  {group.passed}/{group.scored} pass
                </span>
              </div>
              <h3>{group.question}</h3>
              <p className="agent-check-group-points">
                <span className="font-geist-pixel">{formatPoints(group.earned)}</span>
                <small>/{group.available} pts</small>
              </p>
              <div className="agent-check-group-bar" aria-hidden>
                {group.results
                  .filter((check) => check.weight > 0)
                  .map((check) => (
                    <span
                      key={check.id}
                      data-status={check.status}
                      style={{ flexGrow: check.weight }}
                    />
                  ))}
              </div>
              <ul className="agent-check-group-checks">
                {group.results.map((check) => (
                  <li key={check.id} data-status={check.status}>
                    <span>{check.title}</span>
                    <span>{check.weight ? STATUS_LABEL[check.status] : "Reported"}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      {gaps.length > 0 ? (
        <section aria-labelledby="agent-check-gaps-title">
          <div className="agents-section-heading farm-full-rule">
            <div>
              <IndexedLabel index="01" label="Fix these first" />
              <h2 id="agent-check-gaps-title" className="font-geist-pixel">
                {gaps.length} {gaps.length === 1 ? "gap" : "gaps"},
                <br />
                {formatPoints(gaps.reduce((sum, check) => sum + pointsLost(check), 0))} points.
              </h2>
            </div>
            <p>
              Ordered by the points each one costs; a partial result earns half. Each says what the
              check found and how to close it, with the Farm.js config where there is one.
            </p>
          </div>
          <ol className="agent-check-fixes farm-full-rule">
            {gaps.map((check, index) => {
              const Icon = AGENT_CHECK_ICONS[check.id];
              return (
                <li key={check.id}>
                  <span className="agent-check-fix-index font-geist-pixel" aria-hidden>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="agent-check-fix-body">
                    <div className="agent-check-fix-top">
                      <span className="agent-check-fix-name">
                        {Icon ? <Icon aria-hidden size={14} strokeWidth={1.5} /> : null}
                        {check.title}
                      </span>
                      <span className="agent-check-fix-tags">
                        <StatusTag status={check.status} />
                        <span className="agent-check-chip">
                          −{formatPoints(pointsLost(check))} pts
                        </span>
                      </span>
                    </div>
                    <h3>{check.summary}</h3>
                    {check.fix ? <p className="agent-check-fix">{check.fix.summary}</p> : null}
                    {check.fix?.farm ? (
                      <FarmSnippet fix={check.fix.farm} farm={report.farm} />
                    ) : null}
                    <div className="agent-check-fix-more">
                      <Evidence lines={check.evidence} collapsed />
                      {check.fix?.docs ? (
                        <a href={check.fix.docs}>
                          Read the docs <ArrowUpRight aria-hidden size={13} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="agent-check-audit-title">
        <div className="agents-section-heading farm-full-rule">
          <div>
            <IndexedLabel index={gaps.length ? "02" : "01"} label="Every check" />
            <h2 id="agent-check-audit-title" className="font-geist-pixel">
              What the
              <br />
              score is made of.
            </h2>
          </div>
          <p>
            Each check looks at what an agent sees without a browser. Open one for the requests it
            made and what came back.
          </p>
        </div>
        <div className="agent-check-audit farm-full-rule">
          {groups.map((group) => (
            <div key={group.id} className="agent-check-audit-group">
              <div className="agent-check-audit-head">
                <span className="agent-check-row-title">
                  <group.icon aria-hidden size={14} strokeWidth={1.5} />
                  {group.label} · {group.question}
                </span>
                <span>
                  {formatPoints(group.earned)}/{group.available} pts
                </span>
              </div>
              <CheckRows checks={group.results} />
            </div>
          ))}
          {other.length ? (
            <div className="agent-check-audit-group">
              <div className="agent-check-audit-head">
                <span className="agent-check-row-title">Other</span>
              </div>
              <CheckRows checks={other} />
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
