// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createMarkdownMirrorResponse,
  extractFarmPageActions,
  htmlToMarkdown,
  resolveMarkdownConfig,
} from "../markdown";

const form = '<form><input name="email"><button>Send</button></form>';
const page = `<main><h1>Contact</h1><p>Visible</p>${form}</main>`;

describe("Markdown hidden-element absence guard", () => {
  it.each(["", "?actions", "?outline"])(
    "does not tokenize opening tags for a page without hidden markup: %s",
    async (query) => {
      const openingTagSource = /<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g.source;
      const nativeExec = RegExp.prototype.exec;
      let scans = 0;
      const spy = vi
        .spyOn(RegExp.prototype, "exec")
        .mockImplementation(function (this: RegExp, value) {
          if (this.source === openingTagSource) scans++;
          return nativeExec.call(this, value);
        });
      try {
        const response = await createMarkdownMirrorResponse({
          request: new Request(`https://farm.test/contact.md${query}`),
          config: resolveMarkdownConfig(true),
          renderPage: () => new Response(page, { headers: { "content-type": "text/html" } }),
        });
        expect(response!.status).toBe(200);
        await response!.text();
        expect(scans).toBe(0);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it.each([
    ["hidden", false],
    ["HiDdEn", false],
    ['ARIA-HIDDEN="TRUE"', false],
    ['aria-hidden = " true "', false],
    ['hidden="false"', false],
    ['hidden="until-found"', true],
    ['hidden="UNTIL-FOUND"', true],
    ['aria-hidden="false"', true],
    ['title="a hidden gem"', true],
    ["data-x='aria-hidden=\"true\"'", true],
    ["hİdden", true],
  ])("keeps existing attribute semantics for %s", (attributes, visible) => {
    const html = `<main><div ${attributes}><p>Inside</p>${form}</div><p>Tail</p></main>`;
    const markdown = htmlToMarkdown(html, { includeMetadata: false });
    expect(markdown.includes("Inside")).toBe(visible);
    expect(markdown).toContain("Tail");
    expect(extractFarmPageActions(html, new URL("https://farm.test/contact"))).toHaveLength(
      visible ? 1 : 0,
    );
  });

  it("preserves hidden input values and malformed/unclosed element fallbacks", () => {
    const html =
      '<main><div hidden><form><input type="hidden" name="token" value="abc"></form><p>Tail</p></main>';
    expect(htmlToMarkdown(html, { includeMetadata: false })).toBe("Tail\n");
    expect(extractFarmPageActions(html, new URL("https://farm.test/contact"))[0]!.fields).toEqual([
      { name: "token", type: "hidden", value: "abc" },
    ]);
  });

  it("checks the resolved content after streamed segments and scripts are removed", () => {
    const html =
      '<main><!--$?--><template id="B:0"></template><p>Loading</p><!--/$--></main>' +
      `<div hidden id="S:0">${page}<div aria-hidden="true">Decoration</div></div>` +
      '<script>$RC("B:0","S:0"); const decoy = "<div hidden>";</script>';
    expect(htmlToMarkdown(html, { includeMetadata: false })).toBe("# Contact\n\nVisible\n\nSend\n");
    expect(extractFarmPageActions(html, new URL("https://farm.test/contact"))).toHaveLength(1);
  });
});
