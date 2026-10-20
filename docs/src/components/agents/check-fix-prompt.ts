import type { AgentCheckReport, AgentCheckStatus } from "../../lib/agents-check";
import { formatPoints, pointsLost } from "./check-groups";

const STATUS: Record<AgentCheckStatus, string> = {
  pass: "passing",
  warn: "partial",
  fail: "missing",
  info: "reported",
};

/**
 * A prompt for a coding agent that closes a report's gaps, most valuable first: what each
 * check found, how to fix it, and for a Farm.js site the config that does it.
 */
export function agentFixPrompt(report: AgentCheckReport, reportUrl: string): string {
  const host = new URL(report.finalUrl).host;
  const gaps = report.checks
    .filter((check) => check.status === "fail" || check.status === "warn")
    .sort((a, b) => pointsLost(b) - pointsLost(a));
  const lines = [
    `Make ${host} easier for AI agents to read and use.`,
    "",
    `An agent-ready check scored it ${report.score}/100 (${reportUrl}).`,
  ];
  if (!gaps.length) {
    lines.push("Every scored check passes; keep it that way as the site changes.");
  } else {
    lines.push("Close these gaps, most valuable first:", "");
    gaps.forEach((check, index) => {
      lines.push(
        `${index + 1}. ${check.title} (${STATUS[check.status]}, ${formatPoints(pointsLost(check))} points): ${check.summary}`,
      );
      if (check.fix) lines.push(`   Fix: ${check.fix.summary}`);
      if (report.farm && check.fix?.farm) {
        lines.push(`   This is a Farm.js app. In ${check.fix.farm.file}:`, "   ```ts");
        for (const line of check.fix.farm.code.split("\n")) lines.push(`   ${line}`.trimEnd());
        lines.push("   ```");
      }
      if (check.fix?.docs) lines.push(`   Docs: ${check.fix.docs}`);
    });
  }
  lines.push(
    "",
    `Then check it again: https://farmjs.dev/agents/check?url=${encodeURIComponent(report.url)}`,
  );
  return lines.join("\n");
}
