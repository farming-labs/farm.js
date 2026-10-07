// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyMarkdownNegotiationHeaders, resolveMarkdownConfig } from "../markdown";

function runtime(i18n = false) {
  const source = fs.readFileSync(path.join(process.cwd(), "src/nitro/universal-build.ts"), "utf8");
  const start = source.indexOf("async function handleFarmRequest(");
  const inner = source.indexOf("async function handleFarmRequestInContext(", start);
  const end = source.indexOf("  if (farmImageHandler", inner);
  expect(start).toBeGreaterThan(-1);
  expect(inner).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(inner);
  // Expand the same i18n/Markdown template variants as the production builder.
  // Execute its outer handler and real URL/redirect/rewrite prefix; replace
  // the unrelated page renderer with a response exposing the resolved URL.
  const handlers =
    new Function("config", `return \`${source.slice(start, end)}\`;`)({
      i18n: { enabled: i18n },
      md: { enabled: true },
    }) +
    '\nreturn new Response(JSON.stringify({pathname, search: url.search}), {headers:{"content-type":"text/html"}});\n}';
  const parses = vi.fn();
  const routePathname = (pathname: string) =>
    pathname.replace(/^\/base/, "").replace(/^\/fr(?=\/)/, "");
  const request = new Function(
    "URL",
    "getFarmRoutePathname",
    "farmMarkdownConfig",
    "applyMarkdownNegotiationHeaders",
    "matchPageRoute",
    "matchRedirectRoute",
    "configuredRewriteRoutes",
    "hasLocalRequestRoute",
    "matchRewriteRoute",
    "createRewrittenRequest",
    "_runWithCurrentRequest",
    "_runWithFarmI18nRequest",
    "farmI18nRuntime",
    "farmI18nConfig",
    "applyFarmI18nResponse",
    "isFarmLocalAPIPathname",
    `${handlers}\nreturn handleFarmRequest;`,
  )(
    new Proxy(URL, {
      construct(target, args) {
        parses(...args);
        return Reflect.construct(target, args);
      },
    }),
    routePathname,
    resolveMarkdownConfig(undefined),
    applyMarkdownNegotiationHeaders,
    () => true,
    () => null,
    ["/old"],
    (_request: Request, pathname: string) => pathname !== "/old",
    () => "/base/fr/new?q=rewritten",
    (incoming: Request, destination: string) => new Request(new URL(destination, incoming.url)),
    (_request: Request, handler: () => unknown) => handler(),
    (_runtime: unknown, _request: Request, handler: (locale: unknown) => unknown) =>
      handler({ locale: "fr" }),
    {},
    {},
    (response: Response) => response,
    () => false,
  ) as (request: Request, adapterContext?: unknown) => Promise<Response>;
  return { request, parses };
}

describe("production request URL ownership", () => {
  it("parses once for rendering and Markdown response negotiation", async () => {
    const r = runtime();
    const response = await r.request(new Request("https://farm.test/page?q=one&q=two"));
    expect(await response.json()).toEqual({ pathname: "/page", search: "?q=one&q=two" });
    expect(response.headers.get("link")).toContain("</page.md>");
    expect(r.parses).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "reparses configured rewrites without changing original negotiation (i18n=%s)",
    async (i18n) => {
      const r = runtime(i18n);
      const response = await r.request(new Request("https://farm.test/base/fr/old?q=original"));
      expect(await response.json()).toEqual({ pathname: "/base/fr/new", search: "?q=rewritten" });
      // The outer response still negotiates against the original URL, as before.
      expect(response.headers.get("link")).toContain("</old.md>");
    },
  );

  it("keeps parsed URLs local to each concurrent request", async () => {
    const r = runtime();
    const responses = await Promise.all(
      ["one", "two"].map((pathname) =>
        r.request(new Request(`https://farm.test/${pathname}?q=${pathname}`)),
      ),
    );
    expect(await responses[0].json()).toEqual({ pathname: "/one", search: "?q=one" });
    expect(await responses[1].json()).toEqual({ pathname: "/two", search: "?q=two" });
    expect(responses[0].headers.get("link")).toContain("</one.md>");
    expect(responses[1].headers.get("link")).toContain("</two.md>");
    expect(r.parses).toHaveBeenCalledTimes(2);
  });
});
