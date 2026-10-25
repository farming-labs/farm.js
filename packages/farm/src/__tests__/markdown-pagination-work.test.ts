// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { selectFarmMarkdownView } from "../markdown-view";

describe("Markdown pagination remainder counting", () => {
  it("does not join the unreturned tail for its token estimate", () => {
    const tail = "Last paragraph is not part of the first response.";
    const markdown = `# Guide\n\n${"Some ordinary prose.\n\n".repeat(200)}${tail}\n`;
    const nativeJoin = Array.prototype.join;
    let tailJoins = 0;
    const spy = vi
      .spyOn(Array.prototype, "join")
      .mockImplementation(function (this: unknown[], separator) {
        if (separator === "\n" && this.includes(tail)) tailJoins++;
        return nativeJoin.call(this, separator);
      });
    try {
      const view = selectFarmMarkdownView(
        markdown,
        new URLSearchParams("max_tokens=100"),
        "/guide.md",
      );
      expect(view.status).toBe(200);
      expect(view.headers?.Link).toBeDefined();
      expect(view.body).not.toContain(tail);
      expect(tailJoins).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    "# Guide\n\n" + "A paragraph.\n\n".repeat(60),
    "# Guide\n\n" + "A paragraph.\n\n".repeat(60) + "No final newline",
    "# Guide\n\n" + "A paragraph.\n\n".repeat(60) + "\n\n\n",
    "# Guide\r\n\r\n" + "A paragraph.\r\n\r\n".repeat(60),
    "# Unicode\n\n" + "🌾 Café\u2028more\u2029text\t\u00a0\ufeff\n\n".repeat(60),
    "---\ntitle: Guide\n---\n\n# Code\n\n```ts\n" + "const n = 1;\n".repeat(60) + "```\n\nTail\n",
    "# Open fence\n\n~~~~\n" + "Some code\n".repeat(60),
  ])("keeps exact remainder counts across every continuation for %j", (markdown) => {
    const lines = markdown.replace(/\n$/, "").split("\n");
    let query = new URLSearchParams("max_tokens=100&lang=en&lang=fr");
    let parts = 0;
    for (;;) {
      const view = selectFarmMarkdownView(markdown, query, "/guide.md");
      expect(view.status).toBe(200);
      const next = view.headers?.Link?.match(/^<([^>]+)>; rel="next"$/)?.[1];
      if (!next) break;
      query = new URL(next, "https://farm.test").searchParams;
      expect(query.getAll("lang")).toEqual(["en", "fr"]);
      const end = Number(query.get("cursor")!.split(".")[0]);
      const expected = Math.ceil(lines.slice(end).join("\n").length / 4);
      expect(view.body).toContain(`(about ${expected} more tokens)\n`);
      expect(++parts).toBeLessThan(100);
    }
    expect(parts).toBeGreaterThan(1);
  });
});
