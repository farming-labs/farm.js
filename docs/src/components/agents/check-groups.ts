import { BookOpen, DoorOpen, type LucideIcon, Workflow } from "lucide-react";
import type { AgentCheckResult, AgentCheckStatus } from "../../lib/agents-check";

export interface AgentCheckGroup {
  id: "reach" | "read" | "act";
  label: string;
  /** What the group answers, the way an agent would ask it. */
  question: string;
  icon: LucideIcon;
  /** Check ids, in the order the scanner weighs them. */
  checks: readonly string[];
}

/** The ten checks, grouped by what they decide for an agent. Shared by the landing list and the report. */
export const AGENT_CHECK_GROUPS: readonly AgentCheckGroup[] = [
  {
    id: "reach",
    label: "Reach",
    question: "Can agents get in?",
    icon: DoorOpen,
    checks: ["readable", "robots"],
  },
  {
    id: "read",
    label: "Read",
    question: "Can agents read it?",
    icon: BookOpen,
    checks: ["markdown", "llms-txt", "metadata", "json-ld"],
  },
  {
    id: "act",
    label: "Act",
    question: "Can agents use it?",
    icon: Workflow,
    checks: ["mcp", "openapi", "agent-card", "webmcp"],
  },
];

const EARNED: Record<AgentCheckStatus, number> = { pass: 1, warn: 0.5, fail: 0, info: 0 };

/** The points a check earned: all of them when it passes, half when it is partial. */
export function pointsEarned(check: AgentCheckResult): number {
  return check.weight * EARNED[check.status];
}

/** The points a check gives up. */
export function pointsLost(check: AgentCheckResult): number {
  return check.weight - pointsEarned(check);
}

/** Points with at most one decimal: 7.5, not 7.50. */
export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

/**
 * A report's checks by group, in the group's order. Checks a newer scanner adds that no group
 * names yet come last, under "Other", so a report never hides one.
 */
export function groupChecks(checks: readonly AgentCheckResult[]) {
  const known = new Set(AGENT_CHECK_GROUPS.flatMap((group) => group.checks));
  const groups = AGENT_CHECK_GROUPS.map((group) => {
    const members = group.checks.flatMap((id) => checks.filter((check) => check.id === id));
    const scored = members.filter((check) => check.weight > 0);
    return {
      ...group,
      results: members,
      earned: scored.reduce((sum, check) => sum + pointsEarned(check), 0),
      available: scored.reduce((sum, check) => sum + check.weight, 0),
      passed: scored.filter((check) => check.status === "pass").length,
      scored: scored.length,
    };
  });
  const other = checks.filter((check) => !known.has(check.id));
  return { groups, other };
}
