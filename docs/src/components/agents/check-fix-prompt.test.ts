import { describe, expect, it } from "vitest";
import type { AgentCheckReport } from "../../lib/agents-check";
import { agentFixPrompt } from "./check-fix-prompt";

const report = (farm: boolean): AgentCheckReport => ({
  url: "https://acme.test/",
  finalUrl: "https://www.acme.test/",
  scannedAt: "2026-10-20T08:00:00Z",
  durationMs: 900,
  score: 62,
  farm,
  checks: [
    {
      id: "json-ld",
      title: "Structured data (JSON-LD)",
      status: "warn",
      weight: 5,
      summary: "No JSON-LD on the page.",
      evidence: [],
      fix: {
        summary: "Add a schema.org WebSite.",
        farm: {
          file: "farm.config.ts",
          code: "export default defineConfig({\n  agent: { jsonLd: true },\n});",
        },
        docs: "https://farmjs.dev/docs/configuration",
      },
    },
    {
      id: "markdown",
      title: "Markdown version of the page",
      status: "fail",
      weight: 20,
      summary: "No Markdown version of the page was found.",
      evidence: [],
      fix: { summary: "Serve the page as Markdown." },
    },
    {
      id: "robots",
      title: "robots.txt lets agents in",
      status: "pass",
      weight: 15,
      summary: "AI agents can read the page.",
      evidence: [],
    },
  ],
});

describe("agentFixPrompt", () => {
  it("lists the gaps by the points they cost, with fixes, docs and a rescan link", () => {
    const prompt = agentFixPrompt(report(false), "https://farmjs.dev/agents/check/abcdefghijkm");
    expect(prompt).toBe(
      [
        "Make www.acme.test easier for AI agents to read and use.",
        "",
        "An agent-ready check scored it 62/100 (https://farmjs.dev/agents/check/abcdefghijkm).",
        "Close these gaps, most valuable first:",
        "",
        "1. Markdown version of the page (missing, 20 points): No Markdown version of the page was found.",
        "   Fix: Serve the page as Markdown.",
        "2. Structured data (JSON-LD) (partial, 2.5 points): No JSON-LD on the page.",
        "   Fix: Add a schema.org WebSite.",
        "   Docs: https://farmjs.dev/docs/configuration",
        "",
        "Then check it again: https://farmjs.dev/agents/check?url=https%3A%2F%2Facme.test%2F",
      ].join("\n"),
    );
  });

  it("adds the Farm.js config only for a Farm.js site", () => {
    const prompt = agentFixPrompt(report(true), "https://farmjs.dev/agents/check/abcdefghijkm");
    expect(prompt).toContain(
      [
        "   This is a Farm.js app. In farm.config.ts:",
        "   ```ts",
        "   export default defineConfig({",
        "     agent: { jsonLd: true },",
        "   });",
        "   ```",
      ].join("\n"),
    );
  });

  it("says so when nothing is left to fix", () => {
    const passing = { ...report(false), checks: report(false).checks.slice(2), score: 100 };
    expect(agentFixPrompt(passing, "https://farmjs.dev/agents/check/abcdefghijkm")).toContain(
      "Every scored check passes",
    );
  });
});
