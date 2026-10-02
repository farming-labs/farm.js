// @vitest-environment node
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIGURES, type FigureKind } from "./figure-scripts";
import { BlogFigure } from "./figures";

const kinds = Object.keys(FIGURES) as FigureKind[];

describe("launch post figures", () => {
  it("keeps active illustration borders subtle instead of flashing white", () => {
    const css = postcss.parse(readFileSync(new URL("./figures.css", import.meta.url), "utf8"));
    for (const selector of ['.bf-panel[data-state="hot"]', ".bf-card.bf-hot"]) {
      const colors: string[] = [];
      css.walkRules(selector, (rule) => {
        rule.walkDecls("border-color", (declaration) => {
          colors.push(declaration.value);
        });
      });
      expect(colors).toEqual(["rgb(255 255 255 / 0.28)"]);
    }
  });

  it.each(kinds)("renders the %s figure's final frame on the server", (kind) => {
    const html = renderToStaticMarkup(<BlogFigure kind={kind} caption="Caption" />);
    expect(html).toContain(`data-figure="${kind}"`);
    expect(html).toContain(`aria-label="${FIGURES[kind].label.replace(/'/g, "&#x27;")}"`);
    expect(html).toContain("<figcaption>Caption</figcaption>");
    for (const panel of FIGURES[kind].panels) expect(html).toContain(`data-slot="${panel.id}"`);
    for (const wire of Object.keys(FIGURES[kind].wires))
      expect(html).toContain(`data-wire="${wire}"`);
  });

  it("illustrates each flow without repeating the post's code", () => {
    const text = (kind: FigureKind) =>
      Object.values(FIGURES[kind].frame(FIGURES[kind].duration).slots).join(" ");
    expect(text("integration")).toContain("appIntegrations.billing");
    expect(text("integration")).toContain("WEBHOOK_SECRET");
    expect(text("agents")).toContain("this.sql");
    expect(text("agents")).toContain("Durable Object");
    expect(text("webmcp")).toContain("search_products");
    expect(text("preview")).toContain("checkout-test.preview.farmjs.dev");
    // Illustration-only figures never repeat code; merged figures show the post's code verbatim.
    const plain = (html: string) =>
      html
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    for (const kind of kinds) {
      const spec = FIGURES[kind];
      if (!spec.source) {
        expect(text(kind)).not.toMatch(/import |export default|defineConfig/);
        continue;
      }
      let seen = "";
      for (let t = 0; t <= spec.duration; t += 0.1)
        seen +=
          plain(
            Object.values(spec.frame(t).slots)
              .join("\n")
              .replace(/<span class="bf-line/g, "\n$&"),
          ) + "\n";
      // An excerpt names its file and fits its half of the stage; Copy takes the whole source.
      const lines = spec.source.split("\n").filter((l) => l.trim());
      for (const codeLine of spec.excerpt ? lines.slice(0, 1) : lines)
        expect(seen).toContain(codeLine);
      for (const panel of spec.panels.filter((p) => p.code))
        for (let t = 0; t <= spec.duration; t += 0.5)
          for (const shownLine of plain(
            spec.frame(t).slots[panel.id].replace(/<span class="bf-line/g, "\n$&"),
          ).split("\n"))
            expect(shownLine.length).toBeLessThanOrEqual(50);
    }
  });

  it.each(kinds)("draws every %s connector by the end and nothing in the first frame", (kind) => {
    const spec = FIGURES[kind];
    const first = spec.frame(0);
    const last = spec.frame(spec.duration);
    for (const wire of Object.keys(spec.wires)) {
      expect(first.wires[wire].draw).toBe(0);
      expect(last.wires[wire].draw).toBe(1);
      expect(last.wires[wire].pulse).toBeUndefined();
    }
  });

  it.each(kinds)("keeps %s frames well-formed across the timeline", (kind) => {
    const spec = FIGURES[kind];
    for (let t = 0; t <= spec.duration; t += 0.05) {
      const frame = spec.frame(t);
      for (const html of Object.values(frame.slots)) {
        expect(html).not.toMatch(/NaN|undefined/);
        // Script text is escaped: the only tags are the figure's own spans and bubble-tail SVG.
        expect(html.replace(/<\/?(span|svg|path)(\s[^>]*)?\/?>/g, "")).not.toMatch(/[<>]/);
      }
      for (const state of Object.values(frame.wires)) {
        if (state.pulse !== undefined) expect(state.pulse).toBeGreaterThanOrEqual(0);
        if (state.pulse !== undefined) expect(state.pulse).toBeLessThanOrEqual(1);
      }
    }
  });

  it("draws the agents hero as your app -> Farm.js -> agents, MCP, and your site", () => {
    for (const kind of ["agents-flow", "agents-flow-stacked"] as const) {
      const spec = FIGURES[kind];
      const html = renderToStaticMarkup(<BlogFigure fit kind={kind} />);
      for (const text of ["Your app", "Farm.js", "Agents", "MCP", "Your site"])
        expect(html).toContain(text);
      expect(html).not.toContain("bf-controls");
      // every branch of the fork carries a pulse at some point in the loop
      for (const branch of ["in", "agents", "mcp", "site"]) {
        let pulsed = false;
        for (let t = 0; t <= spec.duration; t += 0.05)
          if (spec.frame(t).wires[branch].pulse !== undefined) pulsed = true;
        expect(pulsed).toBe(true);
      }
    }
  });

  it("gives phone layouts every panel, inside the stage, on connectors the animation drives", () => {
    const narrowKinds = kinds.filter((kind) => FIGURES[kind].narrow);
    expect(narrowKinds.length).toBeGreaterThanOrEqual(5);
    for (const kind of narrowKinds) {
      const spec = FIGURES[kind];
      const narrow = spec.narrow!;
      expect(narrow.panels.map((p) => p.id).sort()).toEqual(spec.panels.map((p) => p.id).sort());
      for (const p of narrow.panels) {
        expect(p.x + p.w).toBeLessThanOrEqual(narrow.stage.w);
        expect(p.y + p.h).toBeLessThanOrEqual(narrow.stage.h);
      }
      const driven = Object.keys(spec.frame(spec.duration).wires);
      for (const id of Object.keys(narrow.wires)) expect(driven).toContain(id);
    }
  });
});
