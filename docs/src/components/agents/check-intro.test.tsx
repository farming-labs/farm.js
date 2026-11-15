// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StoredAgentCheck } from "../../lib/agents-check";
import { AgentCheckIntro } from "./check-intro";

const scan: StoredAgentCheck = {
  id: "abc123def456",
  createdAt: "2026-10-24T10:00:00.000Z",
  report: {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scannedAt: "2026-10-24T10:00:00.000Z",
    durationMs: 1200,
    score: 72,
    farm: false,
    checks: [],
  },
};

describe("agent check intro", () => {
  it("shows the intro until there is a report", () => {
    const html = renderToStaticMarkup(
      createElement(AgentCheckIntro, null, createElement("p", null, "intro")),
    );
    expect(html).toBe("<p>intro</p>");
  });

  it("renders a server report whose actions work without JavaScript and name no id", () => {
    const html = renderToStaticMarkup(
      createElement(AgentCheckIntro, { initialScan: scan }, createElement("p", null, "intro")),
    );
    expect(html).not.toContain("<p>intro</p>");
    expect(html).toContain("72");
    // "Scan again" posts the site to the check; "Check another site" is a plain link.
    expect(html).toContain(
      '<form id="agent-check-rescan" hidden="" action="/api/agents/check" method="post">',
    );
    expect(html).toContain('<input type="hidden" name="url" value="https://example.com/"/>');
    expect(html).toContain('form="agent-check-rescan"');
    expect(html).toContain('<a href="/agents/check">Check another site</a>');
    expect(html).not.toContain("abc123def456");
  });
});
