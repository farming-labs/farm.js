// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  generateConfiguredResponseHeadersRuntimeSource,
  generatePreloadResponseRuntimeSource,
} from "../nitro/universal-build";
import { manageFarmDocumentPreloads, manageFarmLinkHeaderPreloads } from "../preload";
import { applyFarmCspNonceToResponse, resolveFarmSecurityConfig } from "../security";

function runtime(options: { headers?: boolean; warn?: boolean; nonce?: boolean } = {}) {
  const source = fs.readFileSync(path.join(process.cwd(), "src/nitro/universal-build.ts"), "utf8");
  const start = source.indexOf(
    "        const prepareResponse = async (runtimeRequest, responsePromise) => {",
  );
  const end = source.indexOf("        const runRequest = ", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const parses = vi.fn();
  const normalize = vi.fn((pathname: string) => pathname.replace(/^\/base\/fr(?=\/|$)/, "") || "/");
  const report = vi.fn();
  const run = new Function(
    "URL",
    "getFarmRoutePathname",
    "configuredHeaderRoutes",
    "matchRuntimePathPattern",
    "appendFarmLinkHeader",
    "applyFarmCspNonceToResponse",
    "farmSecurityConfig",
    "manageFarmDocumentPreloads",
    "manageFarmLinkHeaderPreloads",
    "farmPreloadConfig",
    "reportFarmPreloadWarnings",
    `${generateConfiguredResponseHeadersRuntimeSource()}\n${generatePreloadResponseRuntimeSource()}\n${source.slice(start, end)}\nreturn prepareResponse;`,
  )(
    new Proxy(URL, {
      construct(target, args) {
        parses(...args);
        return Reflect.construct(target, args);
      },
    }),
    normalize,
    options.headers
      ? [
          {
            source: "/target",
            headers: [
              { key: "x-path", value: "target" },
              { key: "Set-Cookie", value: "first=1; Path=/" },
              { key: "Set-Cookie", value: "second=2; Path=/" },
            ],
          },
        ]
      : [],
    (pattern: string, pathname: string) => pattern === pathname,
    (headers: Headers, value: string) => headers.append("Link", value),
    applyFarmCspNonceToResponse,
    resolveFarmSecurityConfig(
      options.nonce ? { csp: { policy: "script-src 'self'", nonce: true } } : undefined,
    ),
    manageFarmDocumentPreloads,
    manageFarmLinkHeaderPreloads,
    { mode: options.warn ? "warn" : "enforce", maxImages: 1, maxFonts: 1 },
    report,
  ) as (request: Request, response: Response | Promise<Response>) => Promise<Response>;
  return { run, parses, normalize, report };
}

const preloadLinks = "</first>; rel=preload; as=image, </second>; rel=preload; as=image";

describe("production response URL ownership", () => {
  it.each(["json", "text", "redirect", "head", "buffered", "unknown-stream"])(
    "does not parse or normalize unused response URLs for %s",
    async (kind) => {
      const r = runtime();
      const request = new Request("https://farm.test/base/fr/target?q=one&q=two", {
        method: kind === "head" ? "HEAD" : "GET",
      });
      const headers = new Headers({
        "content-type":
          kind === "json" ? "application/json" : kind === "text" ? "text/plain" : "text/html",
      });
      if (kind === "buffered") headers.set("x-farm-preload-buffered", "none");
      const response = new Response(kind === "head" || kind === "redirect" ? null : "hello 🌱", {
        headers,
        status: kind === "redirect" ? 302 : 200,
      });
      const output = await r.run(request, response);
      expect(r.parses).not.toHaveBeenCalled();
      expect(r.normalize).not.toHaveBeenCalled();
      expect(output.body).toBe(response.body);
      expect(output.status).toBe(response.status);
      if (kind !== "buffered") expect(output).toBe(response);
      expect(await output.text()).toBe(kind === "head" || kind === "redirect" ? "" : "hello 🌱");
      for (const [warnings, context] of r.report.mock.calls) {
        expect(warnings).toEqual([]);
        expect(context).toBeUndefined();
      }
    },
  );

  it.each([false, true])("resolves warning paths only when needed (warn=%s)", async (warn) => {
    const r = runtime({ warn });
    const output = await r.run(
      new Request("https://farm.test/base/fr/target?q=one&q=two"),
      new Response("<p>hello</p>", {
        headers: { "content-type": "text/html", link: preloadLinks },
      }),
    );
    expect(r.parses).toHaveBeenCalledExactlyOnceWith(
      "https://farm.test/base/fr/target?q=one&q=two",
    );
    expect(r.normalize).toHaveBeenCalledExactlyOnceWith("/base/fr/target");
    expect(r.report).toHaveBeenCalledWith(
      [{ kind: "image", count: 2, budget: 1, removed: warn ? 0 : 1 }],
      "route /target",
    );
    expect(output.headers.get("link")).toBe(
      warn ? preloadLinks : "</first>; rel=preload; as=image",
    );
  });

  it("reuses the configured-header pathname for warnings and preserves cookies", async () => {
    const r = runtime({ headers: true });
    const response = new Response("<p>hello</p>", {
      headers: {
        "content-type": "text/html",
        link: preloadLinks,
        "set-cookie": "original=1; Path=/",
      },
    });
    const output = await r.run(new Request("https://farm.test/base/fr/target"), response);
    expect(r.parses).toHaveBeenCalledTimes(1);
    expect(r.normalize).toHaveBeenCalledTimes(1);
    expect(output.headers.get("x-path")).toBe("target");
    expect(output.headers.getSetCookie()).toEqual([
      "original=1; Path=/",
      "first=1; Path=/",
      "second=2; Path=/",
    ]);
    expect(response.headers.getSetCookie()).toEqual(["original=1; Path=/"]);
    expect(r.report.mock.calls[0][1]).toBe("route /target");
  });

  it("does not share warning paths across concurrent replaced requests", async () => {
    const r = runtime();
    await Promise.all(
      ["one", "two"].map((name) =>
        r.run(
          new Request(`https://farm.test/base/fr/${name}`),
          Promise.resolve(
            new Response("ok", { headers: { "content-type": "text/html", link: preloadLinks } }),
          ),
        ),
      ),
    );
    expect(r.report.mock.calls.map((call) => call[1])).toEqual(["route /one", "route /two"]);
    expect(r.parses).toHaveBeenCalledTimes(2);
  });

  it("does not parse for CSP nonce rewriting without configured headers or warnings", async () => {
    const r = runtime({ nonce: true });
    const output = await r.run(
      new Request("https://farm.test/target"),
      new Response("<script>hello()</script>", {
        headers: { "content-type": "text/html", "content-length": "24" },
      }),
    );
    const nonce = output.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1];
    expect(await output.text()).toBe(`<script nonce="${nonce}">hello()</script>`);
    expect(output.headers.has("content-length")).toBe(false);
    expect(r.parses).not.toHaveBeenCalled();
  });
});
