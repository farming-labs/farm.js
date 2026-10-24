import type { AgentCheckResult, StoredAgentCheck } from "../../lib/agents-check";
import { agentCheckPath } from "../../lib/agents-check-messages";
import { SITE_URL } from "../../lib/site";
import { AgentCheckCopyPrompt } from "./check-copy-prompt";

/**
 * The first buttons under a report's score: what to do next. A site on Farm.js upgrades, since
 * new releases turn agent-ready features on by default; any other site gets its migration guide.
 * Both get a prompt to paste into a coding agent while there are gaps left.
 */

export const FARM_UPGRADE_COMMAND = "farm upgrade --latest";
export const FARM_UPGRADE_DOCS = "/docs/cli#upgrade-farm-packages";

const MIGRATION_GUIDES: Record<string, string> = {
  nextjs: "nextjs",
  nuxt: "nuxt",
  sveltekit: "sveltekit",
  tanstack: "tanstack",
  tanstackstart: "tanstack",
};

/** The migration guide for the framework a site looks built with, or the migrations index. */
export function migrationGuideHref(framework: string | null | undefined): string {
  const key = framework?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  const guide = MIGRATION_GUIDES[key];
  return guide ? `/docs/migrations/${guide}` : "/docs/migrations";
}

const GAP_LABEL = { fail: "Missing", warn: "Partial" } as const;

function lostPoints(check: AgentCheckResult): number {
  return check.status === "fail" ? check.weight : check.weight / 2;
}

/** Checks that cost points, the most expensive first. */
export function reportGaps(scan: StoredAgentCheck): AgentCheckResult[] {
  return scan.report.checks
    .filter((check) => check.status === "fail" || check.status === "warn")
    .sort((a, b) => lostPoints(b) - lostPoints(a));
}

/** Whether the site runs on Farm.js, the way the report's "made with" mark decides it. */
export function isFarmSite(scan: StoredAgentCheck): boolean {
  return scan.report.farm || scan.report.framework === "Farm.js";
}

const absolute = (href: string) => (href.startsWith("/") ? `${SITE_URL}${href}` : href);

function describeGap(check: AgentCheckResult, index: number, farm: boolean): string {
  const status = GAP_LABEL[check.status as keyof typeof GAP_LABEL];
  const lines = [
    `${index + 1}. ${check.title} (${status}${check.weight ? `, ${check.weight} pts` : ""}): ${check.summary}`,
  ];
  if (check.fix?.summary) lines.push(`   Fix: ${check.fix.summary}`);
  if (farm && check.fix?.farm) {
    lines.push(
      `   In ${check.fix.farm.file}:`,
      "   ```",
      ...check.fix.farm.code.split("\n").map((line) => `   ${line}`),
      "   ```",
    );
  }
  if (check.fix?.docs) lines.push(`   Docs: ${absolute(check.fix.docs)}`);
  if (check.evidence.length) {
    lines.push("   What the check saw:", ...check.evidence.map((line) => `   - ${line}`));
  }
  return lines.join("\n");
}

/** A ready-to-paste prompt for a coding agent that takes the site to 100. */
export function buildFixPrompt(scan: StoredAgentCheck): string {
  const { report } = scan;
  const gaps = reportGaps(scan);
  const farm = isFarmSite(scan);
  const intro = [
    `Make ${report.finalUrl} fully agent-ready. The Farm.js agent-ready check (${SITE_URL}/agents/check) scored it ${report.score}/100.`,
    "Fix every gap below in this codebase so the site scores 100/100.",
  ];
  if (farm) {
    intro.push(
      `The site runs on Farm.js. First upgrade every @farm.js/* package together with \`${FARM_UPGRADE_COMMAND}\` (${absolute(FARM_UPGRADE_DOCS)}): newer releases turn most agent-ready features on by default. Rebuild, then fix what is still missing.`,
    );
  }
  return [
    intro.join("\n"),
    `Gaps, the most points first:\n\n${gaps.map((check, index) => describeGap(check, index, farm)).join("\n\n")}`,
    `When you're done, deploy and scan again: ${SITE_URL}${agentCheckPath(report.url)}`,
  ].join("\n\n");
}

export function AgentCheckNextSteps({ scan }: { scan: StoredAgentCheck }) {
  const { report } = scan;
  const hasGaps = reportGaps(scan).length > 0;
  return (
    <div className="agent-check-action-group" role="group" aria-label="Next step">
      {isFarmSite(scan) ? (
        <a className="agent-check-primary" href={FARM_UPGRADE_DOCS}>
          Update to latest Farm.js
          <code>{FARM_UPGRADE_COMMAND}</code>
        </a>
      ) : (
        <a className="agent-check-primary" href={migrationGuideHref(report.framework)}>
          Migrate to Farm.js
        </a>
      )}
      {hasGaps ? <AgentCheckCopyPrompt prompt={buildFixPrompt(scan)} /> : null}
    </div>
  );
}
