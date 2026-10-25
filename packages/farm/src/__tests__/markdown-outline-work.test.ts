// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { parseFarmMarkdownHeadings, selectFarmMarkdownView } from "../markdown-view";

describe("Markdown outline work", () => {
  it.each(["outline", "section=guide"])("splits the document once for %s", (query) => {
    const markdown = "# Guide\n\n## Details\n\nSome text.\n";
    const nativeSplit = String.prototype.split;
    let splits = 0;
    const spy = vi.spyOn(String.prototype, "split").mockImplementation(function (
      this: string,
      ...args
    ) {
      if (String(this) === markdown && args[0] === "\n") splits++;
      return Reflect.apply(nativeSplit, this, args);
    });
    try {
      expect(selectFarmMarkdownView(markdown, new URLSearchParams(query), "/guide.md").status).toBe(
        200,
      );
      expect(splits).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not join section bodies just to count their characters", () => {
    const prose = "Some ordinary prose. ".repeat(1000);
    const markdown = `# Guide\n\n## Details\n\n${prose}\n\n`;
    const nativeJoin = Array.prototype.join;
    let bodyJoins = 0;
    const spy = vi
      .spyOn(Array.prototype, "join")
      .mockImplementation(function (this: unknown[], separator) {
        if (separator === "\n" && this.includes(prose)) bodyJoins++;
        return nativeJoin.call(this, separator);
      });
    try {
      expect(
        selectFarmMarkdownView(markdown, new URLSearchParams("outline"), "/guide.md").status,
      ).toBe(200);
      expect(bodyJoins).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    "",
    "Only prose\n\n",
    "# One",
    "# One\n\n\n",
    "   # Padded   \n\t\n\u00a0\n\ufeff",
    "# Parent\n\n## Child\n\n### Leaf\n\nEmoji: 🌾 and café.\t\n\n## Next\n\nEnd.\n",
    "---\ntitle: Guide\n---\n\n# Title\n\n```md\n## Not a heading\n```\n\n## Details\n\nBody\n",
    "# Repeat\r\n\r\n## Repeat\r\n\r\nText\r\n\r\n## Repeat\r\n\t\r\n",
    "\ufeff # Unicode prefix\n\nLine\u2028\u2029\u2000\u3000\n\n## Last\n\u00a0",
  ])("keeps exact slice/join/trim token estimates for %j", (markdown) => {
    const lines = markdown.split("\n");
    const headings = parseFarmMarkdownHeadings(markdown);
    const expected = headings.map((heading) =>
      Math.ceil(lines.slice(heading.start, heading.end).join("\n").trim().length / 4),
    );
    const view = selectFarmMarkdownView(markdown, new URLSearchParams("outline"), "/guide.md");
    expect(Array.from(view.body.matchAll(/~(\d+) tokens/g), (match) => Number(match[1]))).toEqual(
      expected,
    );
    for (const heading of headings) {
      const section = selectFarmMarkdownView(
        markdown,
        new URLSearchParams({ section: heading.id }),
        "/guide.md",
      );
      expect(section.body).toBe(`${lines.slice(heading.start, heading.end).join("\n").trim()}\n`);
    }
  });
});
