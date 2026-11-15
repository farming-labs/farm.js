import type { AgentCheckResult, StoredAgentCheck } from "../../lib/agents-check";
import { agentCheckPath } from "../../lib/agents-check-messages";
import { SITE_URL } from "../../lib/site";
import { AgentCheckCopyPrompt, AgentCheckCopyText } from "./check-copy-prompt";

/**
 * The first buttons under a report's score: what to do next. A site on an older Farm.js
 * upgrades, since new releases turn agent-ready features on by default; one already on the
 * latest gets the prompt to fix its gaps instead; any other site gets its migration guide.
 * Each gets a prompt to paste into a coding agent while there are gaps left.
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

function parseVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return null;
  return { core: [match[1], match[2], match[3]].map(Number), pre: match[4]?.split(".") ?? [] };
}

/** Semver order of two versions (build metadata ignored), or null when either isn't one. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index++) {
    const difference = left.core[index]! - right.core[index]!;
    if (difference) return Math.sign(difference);
  }
  // A prerelease comes before its release.
  if (!left.pre.length || !right.pre.length) return Math.sign(right.pre.length - left.pre.length);
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index++) {
    const x = left.pre[index];
    const y = right.pre[index];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const numeric = /^\d+$/;
    if (numeric.test(x) && numeric.test(y)) return Math.sign(Number(x) - Number(y));
    if (numeric.test(x) !== numeric.test(y)) return numeric.test(x) ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Whether a Farm.js site should update. "behind": its manifest names an older version than the
 * latest release. "current": it is on the latest (or newer). "unknown": it serves no readable
 * manifest, which only recent Farm.js versions do, so it is likely behind. Null off Farm.js.
 */
export type FarmUpdate =
  | { state: "behind"; from: string; to: string }
  | { state: "current"; version: string }
  | { state: "unknown"; to: string | null };

export function farmUpdate(scan: StoredAgentCheck): FarmUpdate | null {
  if (!isFarmSite(scan)) return null;
  const version = scan.report.farmVersion ?? null;
  const latest = scan.latestFarmVersion ?? null;
  if (!version) return { state: "unknown", to: latest };
  // Without the latest release to compare against, nothing says the site is behind.
  if (!latest) return { state: "current", version };
  const order = compareVersions(version, latest);
  if (order === null) return { state: "unknown", to: latest };
  return order < 0 ? { state: "behind", from: version, to: latest } : { state: "current", version };
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
  const update = farmUpdate(scan);
  const intro = [
    `Make ${report.finalUrl} fully agent-ready. The Farm.js agent-ready check (${SITE_URL}/agents/check) scored it ${report.score}/100.`,
    "Fix every gap below in this codebase so the site scores 100/100.",
  ];
  const upgrade = `with \`${FARM_UPGRADE_COMMAND}\` (${absolute(FARM_UPGRADE_DOCS)}): newer releases turn most agent-ready features on by default. Rebuild, then fix what is still missing.`;
  if (update?.state === "behind") {
    intro.push(
      `The site runs on Farm.js ${update.from}. First upgrade every @farm.js/* package together to ${update.to} ${upgrade}`,
    );
  } else if (update?.state === "unknown") {
    intro.push(
      `The site runs on Farm.js. First make sure every @farm.js/* package is on the latest Farm.js${update.to ? ` (${update.to})` : ""}, upgrading them together ${upgrade}`,
    );
  } else if (update?.state === "current") {
    intro.push(`The site runs on Farm.js ${update.version}, the latest release.`);
  }
  return [
    intro.join("\n"),
    `Gaps, the most points first:\n\n${gaps.map((check, index) => describeGap(check, index, farm)).join("\n\n")}`,
    `When you're done, deploy and scan again: ${SITE_URL}${agentCheckPath(report.url)}`,
  ].join("\n\n");
}

/**
 * A ready-to-paste prompt that moves the site to Farm.js. The Markdown guide it points at is
 * written for coding agents: the whole procedure and a parity table for every feature.
 */
export function buildMigrationPrompt(scan: StoredAgentCheck): string {
  const { report } = scan;
  const guide = migrationGuideHref(report.framework);
  const from = guide === "/docs/migrations" ? "this project" : `this ${report.framework} project`;
  return [
    `Migrate ${from} to Farm.js. The Farm.js agent-ready check (${SITE_URL}/agents/check) scored ${report.finalUrl} ${report.score}/100; Farm.js apps are agent-ready by default.`,
    `Read ${SITE_URL}${guide}.md first and follow it exactly: it is written for coding agents and covers the procedure and every feature to rewrite. Keep the old setup until \`pnpm dev\`, \`pnpm build\` and \`pnpm start\` all pass on Farm.js.`,
    `When you're done, deploy and scan again: ${SITE_URL}${agentCheckPath(report.url)}`,
  ].join("\n\n");
}

export function AgentCheckNextSteps({ scan }: { scan: StoredAgentCheck }) {
  const { report } = scan;
  const hasGaps = reportGaps(scan).length > 0;
  const update = farmUpdate(scan);
  // On the latest Farm.js there is nothing to update: fixing the gaps is the next step.
  if (update?.state === "current") {
    if (!hasGaps) return null;
    return (
      <div className="agent-check-action-group" role="group" aria-label="Next step">
        <AgentCheckCopyPrompt prompt={buildFixPrompt(scan)} className="agent-check-primary" />
      </div>
    );
  }
  return (
    <>
      <div className="agent-check-action-group" role="group" aria-label="Next step">
        {update ? (
          <a className="agent-check-primary" href={FARM_UPGRADE_DOCS}>
            Update Farm.js
          </a>
        ) : (
          <a className="agent-check-primary" href={migrationGuideHref(report.framework)}>
            Migrate to Farm.js
          </a>
        )}
        {hasGaps ? <AgentCheckCopyPrompt prompt={buildFixPrompt(scan)} /> : null}
      </div>
      {update ? (
        <p className="agent-check-command">
          <span>
            {update.state === "behind" ? `Upgrade ${update.from} → ${update.to}` : "Upgrade"}
          </span>
          <code>{FARM_UPGRADE_COMMAND}</code>
          <AgentCheckCopyText text={FARM_UPGRADE_COMMAND} label="Copy" copied="Copied" />
        </p>
      ) : (
        <p className="agent-check-command">
          <span>Migrate with an agent</span>
          <code>{`farmjs.dev${migrationGuideHref(report.framework)}.md`}</code>
          <AgentCheckCopyText
            text={buildMigrationPrompt(scan)}
            label="Copy prompt"
            copied="Copied"
          />
        </p>
      )}
    </>
  );
}
