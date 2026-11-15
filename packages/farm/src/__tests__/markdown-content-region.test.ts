// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createMarkdownMirrorResponse,
  extractFarmPageActions,
  htmlToMarkdown,
  resolveMarkdownConfig,
} from "../markdown";

const form = '<form method="post"><input name="email" required><button>Send</button></form>';
const html = `<html><head><title>Contact</title></head><body><main><h1>Contact</h1>${form}</main></body></html>`;

describe("Markdown mirror content preparation", () => {
  it.each([
    { view: "", status: 200, body: html, passes: 1 },
    { view: "?outline", status: 200, body: html, passes: 1 },
    { view: "?section=contact", status: 200, body: html, passes: 1 },
    { view: "?max_tokens=100", status: 200, body: html, passes: 1 },
    { view: "?actions", status: 200, body: html, passes: 1 },
    { view: "?actions", status: 503, body: html, passes: 1 },
    { view: "", status: 200, body: "<main><h1>No forms</h1></main>", passes: 1 },
    { view: "?actions", status: 200, body: "<main><h1>No forms</h1></main>", passes: 0 },
    { view: "", status: 200, body: `<main hidden>${form}</main>`, passes: 1 },
  ])(
    "prepares the region $passes time(s): $status $view $body",
    async ({ view, status, body, passes }) => {
      for (const method of ["GET", "HEAD"]) {
        // Script removal is one pass in readHtmlContentRegion. Observe its actual
        // execution, keeping native String behavior and restoring the spy promptly.
        const replace = vi.spyOn(String.prototype, "replace");
        try {
          const response = await createMarkdownMirrorResponse({
            request: new Request(`https://farm.test/contact.md${view}`, { method }),
            config: resolveMarkdownConfig(true),
            renderPage: () =>
              new Response(body, { status, headers: { "content-type": "text/html" } }),
          });
          await response!.text();
          expect(
            replace.mock.calls.filter(
              ([pattern]) => pattern instanceof RegExp && pattern.source.startsWith("<script\\b"),
            ),
          ).toHaveLength(passes);
        } finally {
          replace.mockRestore();
        }
      }
    },
  );

  it.each([
    html,
    `<html><head><title>Page title</title></head><body><nav>${form}</nav><main><h1>Visible</h1><div hidden>${form}</div><form><input name="q"></form></main></body></html>`,
    '<main><!--$?--><template id="B:0"></template><form><input name="fallback"></form><!--/$--></main>' +
      `<div hidden id="S:0"><h1>Ready</h1>${form}<div hidden><form><input name="secret"></form></div></div>` +
      '<script>$RC("B:0","S:0")</script>',
    `<main><blockquote><p>a &amp;lt; b &lt;br&gt;</p><pre><code>&lt;form&gt;example&lt;/form&gt;</code></pre></blockquote>` +
      `<table><tr><th>Name</th></tr><tr><td>Farm</td></tr></table>${form}</main>`,
    `<body><main hidden>${form}</main><p>Outside</p></body>`,
    '<main><script>const text = "<form><input name=decoy></form>";</script><h1>Real page</h1></main>',
    `<main><div hidden>Unclosed${form}<p>End</p></main>`,
  ])("matches the standalone converters for %s", async (body) => {
    const pageUrl = new URL("https://farm.test/contact?ref=one&ref=two");
    const actions = extractFarmPageActions(body, pageUrl);
    for (const includeMetadata of [true, false]) {
      const config = resolveMarkdownConfig({
        includeMetadata,
        expose: [{ route: "/contact", title: "Override" }],
      });
      const renderPage = () => new Response(body, { headers: { "content-type": "text/html" } });
      const response = await createMarkdownMirrorResponse({
        request: new Request("https://farm.test/contact.md?ref=one&ref=two"),
        config,
        renderPage,
      });
      expect(await response!.text()).toBe(
        htmlToMarkdown(body, {
          title: "Override",
          sourcePath: "/contact",
          includeMetadata,
          actionsPath: actions.length ? "/contact.md?actions" : undefined,
        }),
      );
      const json = await createMarkdownMirrorResponse({
        request: new Request("https://farm.test/contact.md?ref=one&ref=two&actions"),
        config,
        renderPage,
      });
      expect(await json!.json()).toEqual({ page: "/contact", markdown: "/contact.md", actions });
    }
  });

  it("does not share prepared content or forms between requests", async () => {
    const renderPage = (request: Request) => {
      const reader = request.headers.get("x-reader")!;
      return new Response(`<main><h1>${reader}</h1><form><input name="${reader}"></form></main>`, {
        headers: {
          "content-type": "text/html",
          vary: "X-Reader",
          "cache-control": "private, no-store",
        },
      });
    };
    for (const view of ["", "?actions"]) {
      const responses = await Promise.all(
        ["alice", "bob"].map((reader) =>
          createMarkdownMirrorResponse({
            request: new Request(`https://farm.test/contact.md${view}`, {
              headers: { "x-reader": reader },
            }),
            config: resolveMarkdownConfig(true),
            renderPage,
          }),
        ),
      );
      for (const [index, reader] of ["alice", "bob"].entries()) {
        const response = responses[index]!;
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("vary")).toBe("X-Reader");
        if (view) expect((await response.json()).actions[0].fields[0].name).toBe(reader);
        else expect(await response.text()).toContain(`# ${reader}\n`);
      }
      expect(responses[0]!.headers.get("etag")).not.toBe(responses[1]!.headers.get("etag"));
    }
  });
});
