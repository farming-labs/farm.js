// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createMarkdownMirrorResponse, resolveMarkdownConfig } from "../markdown";

const html = "<h1>Page</h1><p>Whole document.</p><h2>Details</h2><p>More information.</p>";
const markdown = "# Page\n\nWhole document.\n\n## Details\n\nMore information.\n";
const htmlTag = '"html-v1"';
const modified = "Wed, 21 Oct 2015 07:28:00 GMT";
const sourceHeaders = {
  "content-type": "text/html",
  etag: htmlTag,
  "last-modified": modified,
  "accept-ranges": "bytes",
};

function fixture() {
  const renderPage = vi.fn((request: Request) => {
    const validator = request.headers.get("if-none-match");
    if (
      validator === htmlTag ||
      validator === "*" ||
      (validator === null && request.headers.get("if-modified-since") === modified)
    ) {
      return new Response(null, { status: 304, headers: sourceHeaders });
    }
    if (request.headers.has("range")) {
      return new Response(html.slice(0, 8), {
        status: 206,
        headers: {
          ...sourceHeaders,
          "content-range": `bytes 0-7/${html.length}`,
          "content-length": "8",
        },
      });
    }
    return new Response(html, { headers: sourceHeaders });
  });
  const mirror = (path = "/page.md", init: RequestInit = {}) =>
    createMarkdownMirrorResponse({
      request: new Request(`https://farm.test${path}`, init),
      config: resolveMarkdownConfig({ includeMetadata: false }),
      renderPage,
    });
  return { renderPage, mirror };
}

describe("Markdown request validator isolation", () => {
  it.each(["GET", "HEAD"])(
    "does not use HTML validators or byte ranges for a %s mirror",
    async (method) => {
      for (const suffix of [".md", ""]) {
        for (const headers of [
          { "if-none-match": htmlTag },
          { "if-modified-since": modified },
          { range: "bytes=0-7" },
          { range: "bytes=0-7", "if-range": htmlTag },
          { range: "bytes=0-7", "if-range": modified },
          { range: "bytes=999999-" },
          { range: "bytes=0-7,16-23" },
          { range: "invalid" },
          { "if-range": htmlTag },
        ] as Record<string, string>[]) {
          const { mirror, renderPage } = fixture();
          const response = await mirror(`/page${suffix}`, {
            method,
            headers: { ...headers, accept: "text/markdown" },
          });
          expect(response?.status).toBe(200);
          expect(response?.headers.get("etag")).not.toBe(htmlTag);
          for (const name of [
            "content-range",
            "content-length",
            "accept-ranges",
            "last-modified",
          ]) {
            expect(response?.headers.has(name)).toBe(false);
          }
          expect(await response?.text()).toBe(method === "HEAD" ? "" : markdown);
          expect(renderPage).toHaveBeenCalledOnce();
          for (const name of Object.keys(headers))
            expect(renderPage.mock.calls[0][0].headers.has(name)).toBe(false);
        }
      }
    },
  );

  it.each(["", "?outline", "?section=details", "?max_tokens=100", "?actions"])(
    "revalidates the selected view's own ETag (%s)",
    async (query) => {
      const { mirror, renderPage } = fixture();
      const first = await mirror(`/page.md${query}`);
      const etag = first!.headers.get("etag")!;
      const contentType = first!.headers.get("content-type");
      const body = await first!.text();
      expect(etag).toMatch(/^W\/"/);
      for (const method of ["GET", "HEAD"]) {
        for (const suffix of [".md", ""]) {
          for (const validator of [etag, etag.slice(2), `"unrelated", ${etag}`, "*"]) {
            const response = await mirror(`/page${suffix}${query}`, {
              method,
              headers: {
                accept: "text/markdown",
                "if-none-match": validator,
                "if-modified-since": modified,
                range: "bytes=0-7",
                "if-range": htmlTag,
              },
            });
            expect(response?.status).toBe(304);
            expect(response?.body).toBeNull();
            expect(response?.headers.get("etag")).toBe(etag);
            expect(response?.headers.get("content-type")).toBe(contentType);
            expect(response?.headers.get("vary")).toBe(suffix ? null : "Accept");
          }
        }
      }
      const changed = await mirror(`/page.md${query}`, {
        headers: { "if-none-match": '"stale"', "if-modified-since": modified, range: "bytes=0-7" },
      });
      expect(changed?.status).toBe(200);
      expect(await changed?.text()).toBe(body);
      for (const [request] of renderPage.mock.calls) {
        for (const name of ["if-none-match", "if-modified-since", "range", "if-range"])
          expect(request.headers.has(name)).toBe(false);
      }
    },
  );

  it("does not revalidate a section against the full document's ETag", async () => {
    const { mirror } = fixture();
    const full = await mirror();
    const etag = full!.headers.get("etag")!;
    await full!.text();
    const section = await mirror("/page.md?section=details", {
      headers: { "if-none-match": etag, "if-modified-since": modified },
    });
    expect(section?.status).toBe(200);
    expect(section?.headers.get("etag")).not.toBe(etag);
    expect(await section?.text()).toBe("## Details\n\nMore information.\n");
  });

  it("preserves caller identity, cache directives, query values, and cancellation without mutating headers", async () => {
    const controller = new AbortController();
    const headers = {
      accept: "text/markdown",
      authorization: "Bearer test-only",
      cookie: "session=test-only",
      "accept-language": "fr",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "x-request-id": "request-1",
      "if-none-match": htmlTag,
      "if-modified-since": modified,
      range: "bytes=0-7",
      "if-range": htmlTag,
    };
    const request = new Request("https://farm.test/page.md?q=one&q=two&outline", {
      headers,
      signal: controller.signal,
    });
    const before = [...request.headers];
    let inner: Request | undefined;
    const response = await createMarkdownMirrorResponse({
      request,
      config: resolveMarkdownConfig(undefined),
      renderPage: (pageRequest) => {
        inner = pageRequest;
        return new Response(html, { headers: sourceHeaders });
      },
    });
    await response!.text();
    expect(inner!.url).toBe("https://farm.test/page?q=one&q=two");
    expect(inner!.headers.get("accept")).toBe("text/html");
    for (const name of [
      "authorization",
      "cookie",
      "accept-language",
      "cache-control",
      "pragma",
      "x-request-id",
    ])
      expect(inner!.headers.get(name)).toBe(request.headers.get(name));
    expect([...request.headers]).toEqual(before);
    controller.abort("disconnected");
    expect(inner!.signal.aborted).toBe(true);
    expect(inner!.signal.reason).toBe("disconnected");
  });
});
