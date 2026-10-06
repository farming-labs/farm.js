// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMarkdownMirrorResponse, resolveMarkdownConfig } from "../markdown";

// Execute the production caller, not just the helper: cloning before the
// helper's method/negotiation checks used to tee even non-Markdown bodies.
function runtime(config = resolveMarkdownConfig(undefined)) {
  const source = fs.readFileSync(path.join(process.cwd(), "src/nitro/universal-build.ts"), "utf8");
  const start = source.indexOf("  if (farmMarkdownConfig?.enabled) {");
  const end = source.indexOf("\n  }\n", start) + "\n  }\n".length;
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const renderPage = vi.fn((request: Request) => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("accept")).toBe("text/html");
    return new Response("<h1>Farm 🌱</h1>", { headers: { "content-type": "text/html" } });
  });
  const run = new Function(
    "farmMarkdownConfig",
    "createMarkdownMirrorResponse",
    "matchPageRoute",
    "getFarmRoutePathname",
    "handleFarmRequest",
    "applyProductionMiddlewareHeaders",
    `return async function(request) {
      const adapterContext = {};
      const middlewareHeaders = undefined;
      ${source.slice(start, end)}
      return null;
    };`,
  )(
    config,
    createMarkdownMirrorResponse,
    (pathname: string) => pathname === "/page",
    (pathname: string) => pathname,
    renderPage,
    (response: Response) => response,
  ) as (request: Request) => Promise<Response | null>;
  return { run, renderPage };
}

describe("production Markdown request ownership", () => {
  it.each([undefined, "text/html", "text/markdown;q=0"])(
    "does not clone ordinary HTML requests (%s)",
    async (accept) => {
      const request = new Request("https://farm.test/page", {
        headers: accept ? { accept } : undefined,
      });
      const clone = vi.spyOn(request, "clone");
      const r = runtime();
      expect(await r.run(request)).toBeNull();
      expect(clone).not.toHaveBeenCalled();
      expect(r.renderPage).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "HEAD"])("preserves %s mirrors without mutating the caller", async (method) => {
    for (const suffix of [".md", ""]) {
      const request = new Request(`https://farm.test/page${suffix}?q=one&q=two`, {
        method,
        headers: { accept: "text/markdown", cookie: "session=one" },
      });
      const clone = vi.spyOn(request, "clone");
      const r = runtime();
      const response = await r.run(request);
      expect(response?.headers.get("content-type")).toContain("text/markdown");
      expect(response?.headers.get("content-location")).toBe("/page.md");
      expect(response?.headers.get("vary")).toBe(suffix ? null : "Accept");
      expect(await response?.text()).toBe(method === "HEAD" ? "" : "Source: /page\n\n# Farm 🌱\n");
      expect(clone).not.toHaveBeenCalled();
      const target = r.renderPage.mock.calls[0][0];
      expect(target).not.toBe(request);
      expect(target.url).toBe("https://farm.test/page?q=one&q=two");
      expect(target.headers.get("cookie")).toBe("session=one");
      expect(request.headers.get("accept")).toBe("text/markdown");
      expect(request.bodyUsed).toBe(false);
    }
  });

  it("leaves POST bodies untouched, including already-consumed bodies", async () => {
    const request = new Request("https://farm.test/page.md", { method: "POST", body: "payload" });
    const body = request.body;
    const clone = vi.spyOn(request, "clone");
    const r = runtime();
    expect(await r.run(request)).toBeNull();
    expect(request.body).toBe(body);
    expect(request.bodyUsed).toBe(false);
    expect(await request.text()).toBe("payload");
    expect(await r.run(request)).toBeNull();
    expect(clone).not.toHaveBeenCalled();
    expect(r.renderPage).not.toHaveBeenCalled();
  });

  it("retains disabled and missing-route fallbacks", async () => {
    for (const [config, pathname] of [
      [resolveMarkdownConfig(false), "/page.md"],
      [resolveMarkdownConfig(undefined), "/missing.md"],
      [resolveMarkdownConfig({ expose: ["/other"] }), "/page.md"],
    ] as const) {
      const r = runtime(config);
      expect(await r.run(new Request(`https://farm.test${pathname}`))).toBeNull();
      expect(r.renderPage).not.toHaveBeenCalled();
    }
  });
});
