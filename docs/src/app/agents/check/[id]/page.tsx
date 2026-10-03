import { type Metadata, type MetadataProps, notFound, type PageProps } from "@farm.js/core";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AGENT_CHECK_ICONS } from "../../../../components/agents/check-icons";
import { AnnouncementBar, SiteFooter, SiteHeader } from "../../../../components/site-chrome";
import {
  type AgentCheckReport,
  type AgentCheckResult,
  type AgentCheckStatus,
  fetchAgentCheck,
} from "../../../../lib/agents-check";
import "../../../blog/blog.css";
import "../../agents.css";
import "../../../../components/agents/report.css";

function hostOf(report: AgentCheckReport): string {
  return new URL(report.finalUrl).host;
}

function verdict(score: number): string {
  if (score >= 90) return "Agents can read and use it.";
  if (score >= 70) return "Agents can read it, with gaps.";
  if (score >= 40) return "Agents will struggle with it.";
  return "Agents mostly can't use it.";
}

function shortVerdict(score: number): string {
  if (score >= 90) return "Ready";
  if (score >= 70) return "With gaps";
  if (score >= 40) return "Struggles";
  return "Not ready";
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

const points = (value: number) => `${value} ${value === 1 ? "point" : "points"}`;

export async function generateMetadata({
  params,
}: MetadataProps<"/agents/check/[id]">): Promise<Metadata> {
  const scan = await fetchAgentCheck(params.id).catch(() => null);
  if (!scan) return { title: "Agent-ready check — Farm.js" };
  const host = hostOf(scan.report);
  return {
    title: `${host} scores ${scan.report.score}/100 — Agent-ready check`,
    description: `${host}: ${verdict(scan.report.score)} See what it serves to AI agents and how to close each gap.`,
    robots: { index: false },
  };
}

// The field fills from the left to the score, so the artwork is the meter.
const FIELD_ROWS = 34;
const FIELD_COLUMNS = 96;
const field = Array.from({ length: FIELD_ROWS }, (_, row) =>
  Array.from({ length: FIELD_COLUMNS }, (_, column) => {
    const x = column / 12;
    const y = row / 7;
    const contour = Math.sin(y * 3.2 + Math.sin(x * 0.8) * 2.2 + x * 0.55);
    const density = Math.max(0, Math.min(1, (contour + 1) * 0.42 + Math.cos(x * 1.3 - y) * 0.16));
    return " .:-=+*#"[Math.min(7, Math.floor(density * 8))];
  }).join(""),
);

function ScoreArt({
  report,
  gaps,
  passing,
}: {
  report: AgentCheckReport;
  gaps: number;
  passing: number;
}) {
  const filled = Math.round((report.score / 100) * FIELD_COLUMNS);
  return (
    <div className="blog-release-art blog-release-art--full-bleed agent-report-art" aria-hidden>
      <div className="blog-art-label">
        <span>AGENT-READY CHECK</span>
        <span>SCORE / 100</span>
      </div>
      <pre className="blog-ascii-field agent-report-field">
        {field.map((row, index) => (
          <span className="blog-ascii-row" key={index}>
            <span className="agent-report-field-on">{row.slice(0, filled)}</span>
            {row.slice(filled)}
          </span>
        ))}
      </pre>
      <p className="agent-report-score">
        {report.score}
        <span>/100</span>
      </p>
      <div className="blog-art-caption">
        <span>
          {gaps} {gaps === 1 ? "GAP" : "GAPS"} · {passing} PASSING
        </span>
        <span>[ {shortVerdict(report.score).toUpperCase()} ]</span>
      </div>
    </div>
  );
}

function StatusLine({ check }: { check: AgentCheckResult }) {
  let detail = "";
  if (check.weight && check.status === "fail") detail = `0 of ${points(check.weight)}`;
  else if (check.weight && check.status === "warn") detail = `half of ${points(check.weight)}`;
  else if (check.weight) detail = points(check.weight);
  return (
    <p className="agent-report-status" data-status={check.status}>
      <span>{STATUS_LABEL[check.status]}</span>
      {detail ? <span>{detail}</span> : null}
    </p>
  );
}

// Paths, header values and HTML tags in the scanner's sentences read as code.
const CODE_TOKEN = /(<[^<>]+>|Accept: text\/markdown|\B\/[\w.\-/]*[\w\-/])/g;

function Text({ children }: { children: string }) {
  return (
    <>
      {children
        .split(CODE_TOKEN)
        .map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part))}
    </>
  );
}

function Evidence({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <details className="agent-report-evidence">
      <summary>What the check saw</summary>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

function Gap({ check }: { check: AgentCheckResult }) {
  const Icon = AGENT_CHECK_ICONS[check.id];
  return (
    <section
      className="agent-report-gap"
      id={`check-${check.id}`}
      aria-labelledby={`check-${check.id}-title`}
    >
      <h3 id={`check-${check.id}-title`}>
        {Icon ? <Icon size={18} strokeWidth={1.5} aria-hidden /> : null}
        {check.title}
      </h3>
      <StatusLine check={check} />
      <p>
        <Text>{check.summary}</Text>
      </p>
      {check.fix ? (
        <p>
          <strong>How to fix it.</strong> <Text>{check.fix.summary}</Text>
        </p>
      ) : null}
      <Evidence lines={check.evidence} />
    </section>
  );
}

function CheckList({ checks }: { checks: AgentCheckResult[] }) {
  return (
    <ul className="agent-report-list">
      {checks.map((check) => (
        <li key={check.id} data-status={check.status}>
          <strong>{check.title}.</strong> <Text>{check.summary}</Text>
        </li>
      ))}
    </ul>
  );
}

function Contents({ entries }: { entries: [id: string, label: string][] }) {
  return (
    <nav aria-label="In this report" className="blog-contents-links">
      <span className="blog-contents-highlight" aria-hidden="true" />
      <span className="blog-contents-indicator" aria-hidden="true" />
      {entries.map(([id, label], index) => (
        <a key={id} href={`#${id}`}>
          <span className="blog-contents-index" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

export default async function AgentCheckReportPage({ params }: PageProps<"/agents/check/[id]">) {
  const scan = await fetchAgentCheck(params.id);
  if (!scan) notFound();
  const { report } = scan;
  const host = hostOf(report);
  const gaps = report.checks
    .filter((check) => check.status === "fail" || check.status === "warn")
    .sort((a, b) => pointsLost(b) - pointsLost(a));
  const passing = report.checks.filter((check) => check.status === "pass" && check.weight > 0);
  const unscored = report.checks.filter((check) => check.weight === 0);
  // The score is rounded, so the points it misses are counted from it.
  const lost = 100 - report.score;
  const scanned = new Date(scan.createdAt);
  const date = scanned.toLocaleDateString("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  const contents: [string, string][] = [
    ...(gaps.length ? [["to-fix", "What to fix"] as [string, string]] : []),
    ...gaps.map((check): [string, string] => [`check-${check.id}`, check.title]),
    ...(passing.length ? [["passing", "Passing"] as [string, string]] : []),
    ...(unscored.length ? [["not-scored", "Not scored"] as [string, string]] : []),
  ];

  return (
    <div className="farm-home farm-blog farm-agents min-h-screen overflow-x-clip bg-black font-sans text-white">
      <a className="blog-skip-link" href="#agent-report-content">
        Skip to content
      </a>
      <AnnouncementBar />
      <div className="farm-page-grid">
        <div aria-hidden className="farm-page-rail" />
        <div className="farm-page-content min-w-0">
          <SiteHeader activePage="agents" />
          <main id="agent-report-content" tabIndex={-1}>
            <div className="blog-breadcrumb">
              <a href="/agents/check" aria-label="Check another site" title="Check another site">
                <ArrowLeft aria-hidden size={16} />
              </a>
              <div className="agent-report-actions">
                <button type="button" hidden data-agent-check-copy>
                  Copy link
                </button>
                <a href={`/agents/check?url=${encodeURIComponent(report.url)}`}>Scan again</a>
              </div>
            </div>

            <header className="blog-post-header">
              <div className="blog-post-heading">
                <div className="blog-post-meta">
                  <span className="blog-category">Agent-ready check</span>
                  <time dateTime={scan.createdAt}>{date}</time>
                </div>
                <h1>
                  {host} scores {report.score}. <span>{verdict(report.score)}</span>
                </h1>
                <p>
                  {gaps.length
                    ? `${gaps.length} ${gaps.length === 1 ? "gap costs" : "gaps cost"} it ${points(lost)}. Each one below says what's missing and how to add it.`
                    : "Every scored check passes. The report lists what agents found."}
                </p>
                <p className="agent-report-meta">
                  <span>{report.finalUrl}</span>
                  <span>Scanned in {(report.durationMs / 1000).toFixed(1)}s</span>
                  {report.farm ? <span>Built with Farm.js</span> : null}
                </p>
              </div>
              <ScoreArt report={report} gaps={gaps.length} passing={passing.length} />
            </header>

            <div className="blog-reading-grid">
              <aside className="blog-contents">
                <div className="blog-contents-sticky">
                  <p className="blog-contents-title">
                    <span aria-hidden="true">00</span> In this report
                  </p>
                  <Contents entries={contents} />
                </div>
              </aside>
              <div className="blog-reading-column">
                <details className="blog-mobile-contents">
                  <summary>
                    In this report <span>{contents.length} sections</span>
                  </summary>
                  <Contents entries={contents} />
                </details>
                <div className="blog-prose agent-report-prose">
                  {gaps.length ? (
                    <>
                      <h2 id="to-fix">What to fix</h2>
                      <p>
                        Ordered by the points each one costs. A partial result earns half its
                        points.
                      </p>
                      {gaps.map((check) => (
                        <Gap check={check} key={check.id} />
                      ))}
                    </>
                  ) : null}

                  {passing.length ? (
                    <>
                      <h2 id="passing">Passing</h2>
                      <CheckList checks={passing} />
                    </>
                  ) : null}

                  {unscored.length ? (
                    <>
                      <h2 id="not-scored">Not scored</h2>
                      <p>
                        These follow drafts that are still settling, so they're reported but don't
                        change the score.
                      </p>
                      <CheckList checks={unscored} />
                    </>
                  ) : null}
                </div>
                <div className="blog-article-end">
                  <span aria-hidden className="blog-end-mark">
                    ▦
                  </span>
                  <p>Scanned {date}. This report stays at this link.</p>
                </div>
              </div>
            </div>

            <section
              className="agents-open-web farm-full-rule agent-report-next"
              aria-labelledby="agent-check-next-title"
            >
              <div>
                <h2 id="agent-check-next-title">Readable is step one.</h2>
              </div>
              <div className="agents-open-copy">
                <p>
                  The agent infrastructure we're building goes further: one gateway for your tools,
                  and a trace of every agent run.
                </p>
                <div className="agents-links">
                  <a href="/agents/check">
                    Check another site <ArrowRight size={14} aria-hidden />
                  </a>
                  <a href="/agents#waitlist">
                    Join the waitlist <ArrowRight size={14} aria-hidden />
                  </a>
                </div>
              </div>
            </section>
          </main>
          <SiteFooter />
        </div>
        <div aria-hidden className="farm-page-rail" />
      </div>
    </div>
  );
}
