import { describe, expect, it } from "vitest";
import type { AgentCheckResult } from "../../lib/agents-check";
import { formatPoints, groupChecks, pointsEarned, pointsLost } from "./check-groups";

const check = (
  id: string,
  status: AgentCheckResult["status"],
  weight: number,
): AgentCheckResult => ({ id, status, weight, title: id, summary: "", evidence: [] });

describe("groupChecks", () => {
  it("splits a report into Reach, Read and Act with the points each earns", () => {
    const { groups, other } = groupChecks([
      check("readable", "warn", 20),
      check("markdown", "fail", 20),
      check("llms-txt", "pass", 15),
      check("robots", "pass", 15),
      check("metadata", "warn", 10),
      check("mcp", "pass", 10),
      check("openapi", "warn", 5),
      check("json-ld", "pass", 5),
      check("agent-card", "info", 0),
      check("webmcp", "info", 0),
    ]);
    expect(
      groups.map(({ id, earned, available, passed, scored, results }) => ({
        id,
        earned,
        available,
        passed,
        scored,
        checks: results.map((result) => result.id),
      })),
    ).toEqual([
      {
        id: "reach",
        earned: 25,
        available: 35,
        passed: 1,
        scored: 2,
        checks: ["readable", "robots"],
      },
      {
        id: "read",
        earned: 25,
        available: 50,
        passed: 2,
        scored: 4,
        checks: ["markdown", "llms-txt", "metadata", "json-ld"],
      },
      {
        id: "act",
        earned: 12.5,
        available: 15,
        passed: 1,
        scored: 2,
        checks: ["mcp", "openapi", "agent-card", "webmcp"],
      },
    ]);
    // Group points add up to the report's score: 25 + 25 + 12.5 = 62.5.
    expect(groups.reduce((sum, group) => sum + group.earned, 0)).toBe(62.5);
    expect(other).toEqual([]);
  });

  it("keeps a check a newer scanner adds, under Other", () => {
    const { other } = groupChecks([check("readable", "pass", 20), check("sitemap", "pass", 5)]);
    expect(other.map((result) => result.id)).toEqual(["sitemap"]);
  });
});

it("counts points: all for a pass, half for a partial, none otherwise", () => {
  expect(pointsEarned(check("a", "pass", 20))).toBe(20);
  expect(pointsEarned(check("a", "warn", 5))).toBe(2.5);
  expect(pointsLost(check("a", "warn", 5))).toBe(2.5);
  expect(pointsLost(check("a", "fail", 15))).toBe(15);
  expect(pointsLost(check("a", "info", 0))).toBe(0);
  expect([formatPoints(20), formatPoints(2.5)]).toEqual(["20", "2.5"]);
});
