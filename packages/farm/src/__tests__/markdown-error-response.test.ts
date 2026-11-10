// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createMarkdownMirrorResponse, resolveMarkdownConfig } from "../markdown";

const html =
  "<h1>Request failed</h1><p>Access is unavailable.</p><h2>Recovery</h2><p>Try later.</p>";
const markdown = "# Request failed\n\nAccess is unavailable.\n\n## Recovery\n\nTry later.\n";
const queries = [
  "",
  "?outline",
  "?section=recovery",
  "?section=missing",
  "?max_tokens=invalid",
  "?max_tokens=100&cursor=invalid",
  "?actions",
];
const errors = [
  {
    status: 401,
    header: "WWW-Authenticate",
    value: 'Basic realm="farm, private", Bearer realm="farm"',
  },
  { status: 403, header: "Retry-After", value: "60" },
  { status: 404, header: "Retry-After", value: "0" },
  { status: 405, header: "Allow", value: "GET, HEAD" },
  { status: 405, header: "Allow", value: "" },
  { status: 407, header: "Proxy-Authenticate", value: 'Basic realm="proxy"' },
  { status: 429, header: "Retry-After", value: "120" },
  { status: 500, header: "Retry-After", value: "30" },
  { status: 503, header: "Retry-After", value: "Wed, 21 Oct 2026 07:28:00 GMT" },
];

describe("Markdown error responses", () => {
  it.each(errors)(
    "keeps HTML $status and $header ahead of partial views",
    async ({ status, header, value }) => {
      for (const suffix of [".md", ""]) {
        for (const method of ["GET", "HEAD"]) {
          for (const query of queries) {
            const renderPage = vi.fn(
              () =>
                new Response(html, {
                  status,
                  headers: {
                    "content-type": "text/html",
                    "cache-control": "private, no-store",
                    vary: "Cookie, Accept",
                    [header]: value,
                  },
                }),
            );
            const response = await createMarkdownMirrorResponse({
              request: new Request(`https://farm.test/page${suffix}${query}`, {
                method,
                headers: { accept: "text/markdown" },
              }),
              config: resolveMarkdownConfig({ includeMetadata: false, cache: 300 }),
              renderPage,
            });
            expect(response?.status).toBe(status);
            expect(response?.headers.get(header)).toBe(value);
            expect(response?.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
            expect(response?.headers.get("cache-control")).toBe("private, no-store");
            expect(response?.headers.get("vary")).toBe(suffix ? "Cookie" : "Accept, Cookie");
            expect(response?.headers.has("link")).toBe(false);
            expect(await response?.text()).toBe(method === "HEAD" ? "" : markdown);
            expect(renderPage).toHaveBeenCalledOnce();
          }
        }
      }
    },
  );

  it("keeps error cookies and validators without copying HTML representation headers", async () => {
    const mirror = (etag?: string) =>
      createMarkdownMirrorResponse({
        request: new Request("https://farm.test/page.md?section=missing", {
          headers: etag ? { "if-none-match": etag } : undefined,
        }),
        config: resolveMarkdownConfig({ includeMetadata: false, cache: 300 }),
        renderPage: () =>
          new Response(html, {
            status: 401,
            headers: [
              ["content-type", "text/html"],
              ["www-authenticate", 'Basic realm="farm"'],
              ["www-authenticate", 'Bearer realm="farm"'],
              ["content-length", "999"],
              ["content-encoding", "gzip"],
              ["etag", '"html-error"'],
              ["set-cookie", "old=; Max-Age=0; Path=/"],
              ["set-cookie", "session=renewed; Path=/; HttpOnly"],
            ],
          }),
      });
    const first = await mirror();
    const etag = first!.headers.get("etag")!;
    expect(etag).not.toBe('"html-error"');
    expect(etag).toMatch(/^W\/"/);
    expect(await first!.text()).toBe(markdown);
    for (const validator of [etag, "*"]) {
      const response = await mirror(validator);
      expect(response?.status).toBe(401);
      expect(response?.headers.get("www-authenticate")).toBe(
        'Basic realm="farm", Bearer realm="farm"',
      );
      expect(response?.headers.getSetCookie()).toEqual([
        "old=; Max-Age=0; Path=/",
        "session=renewed; Path=/; HttpOnly",
      ]);
      expect(response?.headers.get("cache-control")).toBe("private, no-store");
      expect(response?.headers.has("content-length")).toBe(false);
      expect(response?.headers.has("content-encoding")).toBe(false);
      expect(await response?.text()).toBe(markdown);
    }
  });

  it("does not advertise an actions view on an error page", async () => {
    const response = await createMarkdownMirrorResponse({
      request: new Request("https://farm.test/page.md"),
      config: resolveMarkdownConfig(undefined),
      renderPage: () =>
        new Response(`${html}<form action="/login" method="post"><button>Sign in</button></form>`, {
          status: 401,
          headers: { "content-type": "text/html" },
        }),
    });
    const body = await response!.text();
    expect(body).toContain("Access is unavailable.");
    expect(body).toContain("Sign in");
    expect(body).not.toContain("/page.md?actions");
  });

  it("does not truncate a long error explanation to a valid token budget", async () => {
    const detail = "Recovery instructions. ".repeat(100);
    const response = await createMarkdownMirrorResponse({
      request: new Request("https://farm.test/page.md?max_tokens=100"),
      config: resolveMarkdownConfig({ includeMetadata: false }),
      renderPage: () =>
        new Response(`<h1>Unavailable</h1><p>${detail}</p><p>Contact support.</p>`, {
          status: 503,
          headers: { "content-type": "text/html" },
        }),
    });
    expect(response?.status).toBe(503);
    expect(response?.headers.has("link")).toBe(false);
    expect(await response?.text()).toBe(`# Unavailable\n\n${detail.trim()}\n\nContact support.\n`);
  });

  it.each([302, 307, 401, 403])(
    "keeps retry guidance on generated %s access explanations",
    async (status) => {
      for (const method of ["GET", "HEAD"]) {
        const response = await createMarkdownMirrorResponse({
          request: new Request("https://farm.test/page.md?max_tokens=invalid", { method }),
          config: resolveMarkdownConfig(undefined),
          renderPage: () =>
            new Response("Access unavailable", {
              status,
              headers: {
                "content-type": "text/plain",
                "retry-after": "60",
                ...(status < 400
                  ? { location: "/login" }
                  : { "www-authenticate": 'Bearer realm="farm"' }),
              },
            }),
        });
        expect(response?.status).toBe(status);
        expect(response?.headers.get("retry-after")).toBe("60");
        expect(response?.headers.get("cache-control")).toBe("no-store");
        expect(response?.headers.get(status < 400 ? "location" : "www-authenticate")).toBe(
          status < 400 ? "/login" : 'Bearer realm="farm"',
        );
        expect(await response?.text()).toMatch(
          method === "HEAD" ? /^$/ : /^# (Redirected|Sign-in required|Access denied)/,
        );
      }
    },
  );

  it.each([200, 201])(
    "still validates and selects views for successful %s pages",
    async (status) => {
      for (const [query, expectedStatus, body] of [
        ["?section=recovery", status, "## Recovery\n\nTry later.\n"],
        ["?section=missing", 404, "is not a section"],
        ["?max_tokens=invalid", 400, "max_tokens"],
      ] as const) {
        const response = await createMarkdownMirrorResponse({
          request: new Request(`https://farm.test/page.md${query}`),
          config: resolveMarkdownConfig({ includeMetadata: false }),
          renderPage: () =>
            new Response(html, { status, headers: { "content-type": "text/html" } }),
        });
        expect(response?.status).toBe(expectedStatus);
        expect(await response?.text()).toContain(body);
      }
    },
  );
});
