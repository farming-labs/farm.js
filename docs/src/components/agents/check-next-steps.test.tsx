// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentCheckResult, StoredAgentCheck } from "../../lib/agents-check";
import {
  AgentCheckNextSteps,
  buildFixPrompt,
  buildMigrationPrompt,
  compareVersions,
  farmUpdate,
  migrationGuideHref,
} from "./check-next-steps";

const check = (overrides: Partial<AgentCheckResult>): AgentCheckResult => ({
  id: "markdown",
  title: "Markdown mirrors",
  status: "pass",
  summary: "Pages answer text/markdown.",
  evidence: [],
  weight: 10,
  ...overrides,
});

const scan = (
  report: Partial<StoredAgentCheck["report"]> & { checks: AgentCheckResult[] },
  latestFarmVersion?: string,
): StoredAgentCheck => ({
  id: "abc123def456",
  createdAt: "2026-10-24T10:00:00.000Z",
  ...(latestFarmVersion ? { latestFarmVersion } : {}),
  report: {
    url: "https://example.com",
    finalUrl: "https://example.com/",
    scannedAt: "2026-10-24T10:00:00.000Z",
    durationMs: 1200,
    score: 72,
    farm: false,
    ...report,
  },
});

const gaps = [
  check({
    id: "llms",
    title: "llms.txt",
    status: "warn",
    summary: "llms.txt lists no pages.",
    evidence: ["GET /llms.txt 200, 0 links"],
    weight: 6,
    fix: { summary: "List every page in llms.txt.", docs: "/docs/markdown#llms-txt" },
  }),
  check({
    id: "markdown",
    status: "fail",
    summary: "No page answers text/markdown.",
    weight: 10,
    fix: {
      summary: "Serve a Markdown mirror of each page.",
      farm: { file: "farm.config.ts", code: "agent: { markdown: true }" },
    },
  }),
  check({ id: "canonical", title: "Canonical URL", status: "pass" }),
];

const render = (value: StoredAgentCheck) =>
  renderToStaticMarkup(createElement(AgentCheckNextSteps, { scan: value }));

describe("agent check next steps", () => {
  it("sends a site on another framework to its migration guide first", () => {
    expect(migrationGuideHref("Next.js")).toBe("/docs/migrations/nextjs");
    expect(migrationGuideHref("Nuxt")).toBe("/docs/migrations/nuxt");
    expect(migrationGuideHref("SvelteKit")).toBe("/docs/migrations/sveltekit");
    expect(migrationGuideHref("TanStack Start")).toBe("/docs/migrations/tanstack");
    expect(migrationGuideHref("Hugo")).toBe("/docs/migrations");
    expect(migrationGuideHref(null)).toBe("/docs/migrations");

    const html = render(scan({ framework: "Next.js", checks: gaps }));
    expect(html).toMatch(
      /^<div class="agent-check-action-group" role="group" aria-label="Next step"><a class="agent-check-primary" href="\/docs\/migrations\/nextjs">/,
    );
    expect(html).toContain(">Migrate to Farm.js</a>");
    // Copying needs JavaScript: the button renders hidden until it hydrates.
    expect(html).toContain('<button type="button" hidden="">Copy prompt to fix</button>');
  });

  it("offers a migration prompt that points an agent at the Markdown guide", () => {
    const prompt = buildMigrationPrompt(scan({ framework: "Next.js", checks: gaps }));
    expect(prompt).toContain("Migrate this Next.js project to Farm.js.");
    expect(prompt).toContain("https://farmjs.dev/docs/migrations/nextjs.md");
    expect(buildMigrationPrompt(scan({ framework: "Hugo", checks: gaps }))).toContain(
      "Migrate this project to Farm.js.",
    );
    const html = render(scan({ framework: "Next.js", checks: gaps }));
    expect(html).toContain("<code>farmjs.dev/docs/migrations/nextjs.md</code>");
  });

  it("orders versions the way semver does", () => {
    expect(compareVersions("0.1.34", "0.1.35")).toBe(-1);
    expect(compareVersions("0.1.35", "0.1.35")).toBe(0);
    expect(compareVersions("0.2.0", "0.1.35")).toBe(1);
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareVersions("0.1.35-beta.2", "0.1.35")).toBe(-1);
    expect(compareVersions("0.1.36-beta.0", "0.1.35")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(compareVersions("1.0.0+build.1", "1.0.0")).toBe(0);
    expect(compareVersions("latest", "0.1.35")).toBeNull();
  });

  it("tells a Farm.js site on an older version to update, from what to what", () => {
    const value = scan({ farm: true, farmVersion: "0.1.30", checks: gaps }, "0.1.35");
    expect(farmUpdate(value)).toEqual({ state: "behind", from: "0.1.30", to: "0.1.35" });
    const html = render(value);
    expect(html).toContain(
      '<a class="agent-check-primary" href="/docs/cli#upgrade-farm-packages">Update Farm.js</a>',
    );
    expect(html).toContain(
      "<span>Upgrade 0.1.30 → 0.1.35</span><code>farm upgrade --latest</code>",
    );
    expect(html).toContain('<button type="button" hidden="">Copy prompt to fix</button>');
    expect(html).not.toContain("Migrate to Farm.js");
    expect(buildFixPrompt(value)).toContain(
      "The site runs on Farm.js 0.1.30. First upgrade every @farm.js/* package together to 0.1.35 with `farm upgrade --latest`",
    );
  });

  it("asks a Farm.js site whose version is unknown to make sure it is on the latest", () => {
    // No manifest (older Farm.js, or a report saved before versions were read), or no latest.
    for (const value of [
      scan({ farm: true, checks: gaps }, "0.1.35"),
      scan({ farm: false, framework: "Farm.js", farmVersion: null, checks: gaps }, "0.1.35"),
      scan({ farm: true, checks: gaps }),
    ]) {
      expect(farmUpdate(value)?.state).toBe("unknown");
      const html = render(value);
      expect(html).toContain('href="/docs/cli#upgrade-farm-packages"');
      expect(html).toContain(">Update Farm.js</a>");
      expect(html).toContain("<span>Upgrade</span><code>farm upgrade --latest</code>");
      expect(html).not.toContain("Migrate to Farm.js");
      expect(buildFixPrompt(value)).toContain(
        "First make sure every @farm.js/* package is on the latest Farm.js",
      );
    }
    expect(buildFixPrompt(scan({ farm: true, checks: gaps }, "0.1.35"))).toContain(
      "on the latest Farm.js (0.1.35), upgrading them together with `farm upgrade --latest`",
    );
  });

  it("asks a Farm.js site on the latest version to fix its gaps, not to update", () => {
    for (const value of [
      scan({ farm: true, farmVersion: "0.1.35", checks: gaps }, "0.1.35"),
      scan({ farm: true, farmVersion: "0.1.36-beta.1", checks: gaps }, "0.1.35"),
      // farmjs.dev couldn't tell the latest: nothing says the site is behind.
      scan({ farm: true, farmVersion: "0.1.30", checks: gaps }),
    ]) {
      expect(farmUpdate(value)?.state).toBe("current");
      const html = render(value);
      expect(html).toBe(
        '<div class="agent-check-action-group" role="group" aria-label="Next step"><button type="button" class="agent-check-primary" hidden="">Copy prompt to fix</button></div>',
      );
      const prompt = buildFixPrompt(value);
      expect(prompt).toContain(
        `The site runs on Farm.js ${value.report.farmVersion}, the latest release.`,
      );
      expect(prompt).not.toMatch(/upgrade/i);
      // Farm.js fixes still come with their config.
      expect(prompt).toContain("agent: { markdown: true }");
    }
    const done = scan(
      { farm: true, farmVersion: "0.1.35", score: 100, checks: [check({ status: "pass" })] },
      "0.1.35",
    );
    expect(render(done)).toBe("");
  });

  it("drops the prompt when nothing is left to fix", () => {
    const html = render(scan({ score: 100, checks: [check({ status: "pass" })] }));
    expect(html).toContain("Migrate to Farm.js");
    expect(html).not.toContain("Copy prompt to fix");
  });

  it("builds a prompt with every gap, most points first, and its fix", () => {
    const prompt = buildFixPrompt(scan({ framework: "Next.js", checks: gaps }));
    expect(prompt).toContain("Make https://example.com/ fully agent-ready");
    expect(prompt).toContain(
      "agent-ready check (https://farmjs.dev/agents/check) scored it 72/100.",
    );
    // Reports are linked by site, never by id.
    expect(prompt).not.toContain("abc123def456");
    expect(prompt).toContain("so the site scores 100/100");
    expect(prompt).not.toMatch(/upgrade/i);
    expect(prompt).not.toContain("Canonical URL");
    expect(prompt.indexOf("1. Markdown mirrors (Missing, 10 pts)")).toBeGreaterThan(0);
    expect(
      prompt.indexOf("2. llms.txt (Partial, 6 pts): llms.txt lists no pages."),
    ).toBeGreaterThan(prompt.indexOf("1. Markdown mirrors"));
    expect(prompt).toContain("Fix: List every page in llms.txt.");
    expect(prompt).toContain("Docs: https://farmjs.dev/docs/markdown#llms-txt");
    expect(prompt).toContain("- GET /llms.txt 200, 0 links");
    // Farm config snippets only help a site that runs Farm.js.
    expect(prompt).not.toContain("agent: { markdown: true }");
    expect(buildFixPrompt(scan({ farm: true, checks: gaps }))).toContain(
      "agent: { markdown: true }",
    );
    expect(prompt).toContain(
      "scan again: https://farmjs.dev/agents/check?url=https%3A%2F%2Fexample.com",
    );
  });
});
