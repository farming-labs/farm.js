// @vitest-environment node

import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createPPRRefreshScript } from "../server/renderer";

describe("PPR refresh DOM reconciliation", () => {
  it("updates server content without replacing live form, focus, selection, or scroll state", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<!doctype html><div id="root" data-version="fresh">
        <label for="name">Fresh label</label>
        <input id="name" value="server-fresh">
        <section id="panel"><p>Fresh content</p><strong>Added</strong></section>
      </div>`,
    });
    const dom = new JSDOM(
      `<!doctype html><div id="root" data-version="stale">
        <label for="name">Stale label</label>
        <input id="name" value="server-stale">
        <section id="panel"><p>Stale content</p><em>Remove me</em></section>
      </div>${createPPRRefreshScript()}`,
      {
        pretendToBeVisual: true,
        runScripts: "dangerously",
        url: "https://example.test/dashboard",
        beforeParse(window) {
          Object.defineProperty(window, "fetch", { value: fetch });
        },
      },
    );
    const { document } = dom.window;
    const root = document.getElementById("root")!;
    const input = document.getElementById("name") as HTMLInputElement;
    const panel = document.getElementById("panel")!;
    input.value = "user draft";
    input.focus();
    input.setSelectionRange(2, 7, "forward");
    panel.scrollTop = 120;

    await vi.waitFor(() => expect(root.dataset.version).toBe("fresh"));

    expect(document.getElementById("root")).toBe(root);
    expect(document.getElementById("name")).toBe(input);
    expect(document.getElementById("panel")).toBe(panel);
    expect(input.value).toBe("user draft");
    expect(input.defaultValue).toBe("server-fresh");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
      2,
      7,
      "forward",
    ]);
    expect(panel.scrollTop).toBe(120);
    expect(panel.textContent).toContain("Fresh content");
    expect(panel.querySelector("strong")?.textContent).toBe("Added");
    expect(panel.querySelector("em")).toBeNull();
  });
});
