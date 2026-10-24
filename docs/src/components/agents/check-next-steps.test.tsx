// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentCheckResult, StoredAgentCheck } from "../../lib/agents-check";
import { AgentCheckNextSteps, buildFixPrompt, migrationGuideHref } from "./check-next-steps";

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
): StoredAgentCheck => ({
  id: "abc123def456",
  createdAt: "2026-10-24T10:00:00.000Z",
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
    expect(html.startsWith('<a class="agent-check-primary" href="/docs/migrations/nextjs">')).toBe(
      true,
    );
    expect(html).toContain(">Migrate to Farm.js</a>");
    // Copying needs JavaScript: the button renders hidden until it hydrates.
    expect(html).toContain('<button type="button" hidden="">Copy prompt to fix</button>');
  });

  it("asks a Farm.js site to upgrade first and shows the command", () => {
    for (const value of [
      scan({ farm: true, checks: gaps }),
      scan({ farm: false, framework: "Farm.js", checks: gaps }),
    ]) {
      const html = render(value);
      expect(html).toContain('href="/docs/cli#upgrade-farm-packages"');
      expect(html).toContain("Update to latest Farm.js<code>farm upgrade --latest</code>");
      expect(html).not.toContain("Migrate to Farm.js");
      expect(buildFixPrompt(value)).toContain("First upgrade every @farm.js/* package");
    }
  });

  it("drops the prompt when nothing is left to fix", () => {
    const html = render(scan({ score: 100, checks: [check({ status: "pass" })] }));
    expect(html).toContain("Migrate to Farm.js");
    expect(html).not.toContain("Copy prompt to fix");
  });

  it("builds a prompt with every gap, most points first, and its fix", () => {
    const prompt = buildFixPrompt(scan({ framework: "Next.js", checks: gaps }));
    expect(prompt).toContain("Make https://example.com/ fully agent-ready");
    expect(prompt).toContain("scored it 72/100: https://farmjs.dev/agents/check/abc123def456");
    expect(prompt).toContain("so the site scores 100/100");
    expect(prompt).not.toContain("upgrade every @farm.js");
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
