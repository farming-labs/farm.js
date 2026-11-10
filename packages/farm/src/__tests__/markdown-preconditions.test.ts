// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createFarmMarkdownSourceResponse } from "../app-markdown-runtime";
import { createMarkdownMirrorResponse, resolveMarkdownConfig } from "../markdown";

const html = "<h1>Page</h1><p>Whole document.</p><h2>Details</h2><p>More information.</p>";
const markdown = "# Page\n\nWhole document.\n\n## Details\n\nMore information.\n";
const htmlTag = '"html-v1"';
const oldDate = "Tue, 20 Oct 2015 07:28:00 GMT";
const modified = "Wed, 21 Oct 2015 07:28:00 GMT";

function fixture(source = false, status = 200) {
  const renderPage = vi.fn((request: Request) => {
    const headers = {
      "content-type": "text/html",
      etag: htmlTag,
      "last-modified": modified,
      "cache-control": "public, max-age=300",
      vary: "Accept-Language",
      "set-cookie": "session=test; HttpOnly",
      "retry-after": "60",
    };
    const match = request.headers.get("if-match");
    if (
      status === 200 &&
      ((match !== null && match !== "*" && match !== htmlTag) ||
        (match === null && request.headers.get("if-unmodified-since") === oldDate))
    ) {
      return new Response("<h1>HTML precondition failed</h1>", { status: 412, headers });
    }
    return new Response(html, { status, headers });
  });
  const run = (path = "/page.md", init: RequestInit = {}) => {
    const request = new Request(`https://farm.test${path}`, init);
    return source
      ? createFarmMarkdownSourceResponse({
          request,
          resolveSource: () => ({ filePath: "/app/page.md", source: markdown }),
        })
      : createMarkdownMirrorResponse({
          request,
          config: resolveMarkdownConfig({ includeMetadata: false }),
          renderPage,
        });
  };
  return { run, renderPage };
}

describe.each([false, true])("Markdown preconditions (raw source: %s)", (source) => {
  it.each(["", "?outline", "?section=details", "?max_tokens=100", "?actions"])(
    "uses strong If-Match comparison for the selected representation (%s)",
    async (query) => {
      const { run, renderPage } = fixture(source);
      const first = await run(`/page.md${query}`);
      const etag = first!.headers.get("etag")!;
      await first!.text();
      for (const method of ["GET", "HEAD"]) {
        for (const suffix of [".md", ""]) {
          for (const match of [
            htmlTag,
            etag,
            etag.slice(2),
            `"other", ${etag}`,
            '"*"',
            '*, "other"',
            "",
          ]) {
            for (const noneMatch of [undefined, "*"]) {
              const response = await run(`/page${suffix}${query}`, {
                method,
                headers: {
                  accept: "text/markdown",
                  "if-match": match,
                  ...(noneMatch ? { "if-none-match": noneMatch } : {}),
                },
              });
              expect(response?.status).toBe(412);
              expect(response?.body).toBeNull();
              expect(response?.headers.get("etag")).toBe(etag);
              expect(response?.headers.get("cache-control")).toBe("no-store");
              expect(response?.headers.get("content-location")).toBe("/page.md");
              if (!suffix) expect(response?.headers.get("vary")).toContain("Accept");
              if (!source) {
                expect(response?.headers.get("set-cookie")).toBe("session=test; HttpOnly");
                expect(response?.headers.get("vary")).toContain("Accept-Language");
              }
            }
          }
        }
      }
      for (const [request] of renderPage.mock.calls) {
        expect(request.headers.has("if-match")).toBe(false);
        expect(request.headers.has("if-unmodified-since")).toBe(false);
      }
    },
  );

  it("allows the existence wildcard, then evaluates If-None-Match", async () => {
    const { run } = fixture(source);
    for (const method of ["GET", "HEAD"]) {
      const first = await run("/page.md", {
        method,
        headers: { "if-match": " * ", "if-unmodified-since": oldDate },
      });
      expect(first?.status).toBe(200);
      expect(await first?.text()).toBe(method === "HEAD" ? "" : markdown);
      const cached = await run("/page.md", {
        method,
        headers: { "if-match": "*", "if-none-match": first!.headers.get("etag")! },
      });
      expect(cached?.status).toBe(304);
      expect(cached?.body).toBeNull();
    }
  });

  it("ignores dates when the Markdown representation has no modification date", async () => {
    const { run, renderPage } = fixture(source);
    for (const date of [oldDate, modified, "Wed, 21 Oct 2099 07:28:00 GMT", "invalid"]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await run("/page.md", {
          method,
          headers: { "if-unmodified-since": date },
        });
        expect(response?.status).toBe(200);
        expect(response?.headers.has("last-modified")).toBe(false);
        expect(await response?.text()).toBe(method === "HEAD" ? "" : markdown);
      }
    }
    for (const [request] of renderPage.mock.calls)
      expect(request.headers.has("if-unmodified-since")).toBe(false);
  });

  it("preserves view validation errors and leaves mutation requests alone", async () => {
    const { run } = fixture(source);
    for (const [query, status] of [
      ["?section=missing", 404],
      ["?max_tokens=invalid", 400],
    ] as const) {
      const response = await run(`/page.md${query}`, { headers: { "if-match": '"stale"' } });
      expect(response?.status).toBe(status);
      expect(await response?.text()).not.toBe("");
    }
    expect(
      await run("/page.md", { method: "POST", headers: { "if-match": '"stale"' } }),
    ).toBeNull();
  });
});

describe("Markdown precondition precedence and isolation", () => {
  it.each([200, 201])("applies preconditions to successful %s representations", async (status) => {
    const { run } = fixture(false, status);
    const response = await run("/page.md", { headers: { "if-match": htmlTag } });
    expect(response?.status).toBe(412);
    expect(response?.body).toBeNull();
  });

  it.each([302, 401, 403, 429])("preserves terminal or access %s responses", async (status) => {
    const renderPage = vi.fn(
      () =>
        new Response("Stopped", {
          status,
          headers: { "content-type": "text/plain", location: "/login", "retry-after": "60" },
        }),
    );
    const response = await createMarkdownMirrorResponse({
      request: new Request("https://farm.test/page.md", { headers: { "if-match": '"stale"' } }),
      config: resolveMarkdownConfig(undefined),
      renderPage,
    });
    // Redirect/access explanations keep their original status, never a new 412.
    expect(response?.status).toBe(status);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(await response?.text()).not.toBe("");
    expect(renderPage).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 404, 412, 429, 503])(
    "preserves a page's %s status and body",
    async (status) => {
      const { run } = fixture(false, status);
      const response = await run("/page.md?outline", {
        headers: { "if-match": '"stale"', "if-none-match": "*", "if-unmodified-since": oldDate },
      });
      expect(response?.status).toBe(status);
      expect(response?.headers.get("retry-after")).toBe("60");
      expect(await response?.text()).toBe(markdown);
    },
  );

  it("preserves the original request and ordinary HTML requests", async () => {
    const headers = {
      "if-match": "*",
      "if-unmodified-since": oldDate,
      authorization: "Bearer test",
    };
    const request = new Request("https://farm.test/page.md", { headers });
    const before = [...request.headers];
    const renderPage = vi.fn(
      () => new Response(html, { headers: { "content-type": "text/html" } }),
    );
    const response = await createMarkdownMirrorResponse({
      request,
      config: resolveMarkdownConfig(undefined),
      renderPage,
    });
    expect(response?.status).toBe(200);
    await response?.text();
    expect([...request.headers]).toEqual(before);
    expect(renderPage.mock.calls).toHaveLength(1);
    expect(
      await createMarkdownMirrorResponse({
        request: new Request("https://farm.test/page", { headers }),
        config: resolveMarkdownConfig(undefined),
        renderPage,
      }),
    ).toBeNull();
    expect(renderPage.mock.calls).toHaveLength(1);
  });
});
