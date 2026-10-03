// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentArtwork } from "./artwork";

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
});
