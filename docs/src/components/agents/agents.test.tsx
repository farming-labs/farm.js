// @vitest-environment node
import { existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGENT_SETUP_PROMPT, AgentPromptButton } from "./agent-prompt";
import { AgentArtwork } from "./artwork";

// Served by the docs engine rather than a page under src/app.
const generatedRoutes = new Set(["/skill.md", "/AGENTS.md", "/llms.txt"]);

describe("agent infrastructure components", () => {
  it("renders a deterministic decorative ASCII network without a canvas", () => {
    const first = renderToStaticMarkup(createElement(AgentArtwork));
    expect(renderToStaticMarkup(createElement(AgentArtwork))).toBe(first);
    expect(first).toContain('class="agent-artwork" aria-hidden="true"');
    expect(first.match(/class="agent-ascii-row"/g)).toHaveLength(54);
    expect(first).toContain("[ Concept ]");
    expect(first).toContain("Your app");
    expect(first).not.toContain("<canvas");
  });

  it("fills the widest page rail with characters instead of a center-only mesh", () => {
    const html = renderToStaticMarkup(createElement(AgentArtwork));
    const rows = [...html.matchAll(/class="agent-ascii-row"[^>]*>([^<]*)<\/span>/g)].map(
      ([, row]) => row,
    );
    expect(rows).toHaveLength(54);
    for (const row of rows) expect(row).toHaveLength(240);
    expect(rows.map((row) => row.slice(0, 32)).join("")).toMatch(/[.:+=x#]/);
    expect(rows.map((row) => row.slice(-32)).join("")).toMatch(/[.:+=x#]/);
  });

  it("points the agent prompt only at pages farmjs.dev serves", () => {
    const urls = (AGENT_SETUP_PROMPT.match(/https?:\/\/[^\s),]+/g) ?? []).map((url) =>
      url.replace(/\.$/, ""),
    );
    expect(urls.length).toBeGreaterThanOrEqual(12);
    for (const url of urls) {
      const { origin, pathname } = new URL(url);
      expect(origin, url).toBe("https://farmjs.dev");
      if (generatedRoutes.has(pathname)) continue;
      expect(pathname, url).toMatch(/\.md$/);
      const page = new URL(`../../app${pathname.replace(/\.md$/, "")}/page.md`, import.meta.url);
      expect(existsSync(page), `${url} has no ${page.pathname}`).toBe(true);
    }
  });

  it("renders the prompt button with every label in place, so copying never resizes it", () => {
    const html = renderToStaticMarkup(createElement(AgentPromptButton));
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Copy agent prompt for Claude Code, Codex, or Cursor"');
    expect(html.match(/data-mark="/g)).toHaveLength(3);
    expect(html).toContain('<span data-active="true">Copy agent prompt</span>');
    expect(html).toContain("<span>Prompt copied</span>");
    expect(html).toContain("<span>Copy failed</span>");
  });
});
