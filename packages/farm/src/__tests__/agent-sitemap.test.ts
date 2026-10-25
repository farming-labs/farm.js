import { describe, expect, it } from "vitest";
import { createFarmDefaultSitemap, resolveFarmAgentSitemap } from "../agent-sitemap";
import { createFarmMetadataRouteResponse } from "../metadata-route";

const config = resolveFarmAgentSitemap(true);

describe("createFarmDefaultSitemap", () => {
  it("lists static pages in path order with absolute URLs and lastmod", () => {
    expect(
      createFarmDefaultSitemap(
        [
          { pattern: "/pricing", lastModified: "2026-10-01T00:00:00.000Z" },
          { pattern: "/" },
          { pattern: "/blog/[slug]" },
          { pattern: "/docs/[[...slug]]" },
          { pattern: "/(.)photo" },
          { pattern: "/pricing" },
        ],
        { origin: "http://localhost:3000", config },
      ),
    ).toEqual([
      { url: "http://localhost:3000/" },
      { url: "http://localhost:3000/pricing", lastModified: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it("leaves out noindex pages and pages behind a route guard", () => {
    expect(
      createFarmDefaultSitemap(
        [
          { pattern: "/" },
          { pattern: "/drafts", module: { metadata: { robots: { index: false } } } },
          { pattern: "/hidden", module: { metadata: { robots: "noindex, follow" } } },
          { pattern: "/account", module: { __farmRouteGuard: () => {} } },
        ],
        { origin: "https://acme.test", config },
      ).map((entry) => entry.url),
    ).toEqual(["https://acme.test/"]);
  });

  it("uses metadataBase over the request origin, below the basePath", () => {
    expect(
      createFarmDefaultSitemap([{ pattern: "/about" }], {
        origin: "http://attacker.test",
        config,
        metadataBase: new URL("https://acme.test/ignored/"),
        basePath: "/app",
      }),
    ).toEqual([{ url: "https://acme.test/app/about" }]);
    // A relative or non-http metadataBase cannot make URLs absolute.
    expect(
      createFarmDefaultSitemap([{ pattern: "/" }], {
        origin: "https://acme.test",
        config,
        metadataBase: "javascript:alert(1)",
      }),
    ).toEqual([{ url: "https://acme.test/" }]);
  });

  it("applies include and exclude route patterns", () => {
    const pages = ["/", "/admin", "/admin/users", "/blog", "/blog/hello"].map((pattern) => ({
      pattern,
    }));
    const urls = (input: Parameters<typeof resolveFarmAgentSitemap>[0]) =>
      createFarmDefaultSitemap(pages, {
        origin: "https://acme.test",
        config: resolveFarmAgentSitemap(input),
      }).map((entry) => new URL(entry.url).pathname);
    expect(urls({ exclude: ["/admin/[[...path]]"] })).toEqual(["/", "/blog", "/blog/hello"]);
    expect(urls({ include: ["/blog/[...slug]"] })).toEqual(["/blog/hello"]);
  });

  it("serializes as a sitemap protocol urlset", async () => {
    const response = createFarmMetadataRouteResponse(
      "sitemap",
      createFarmDefaultSitemap([{ pattern: "/", lastModified: "2026-10-01T00:00:00.000Z" }], {
        origin: "https://acme.test",
        config,
      }),
    );
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(await response.text()).toContain(
      "<url>\n    <loc>https://acme.test/</loc>\n    <lastmod>2026-10-01T00:00:00.000Z</lastmod>\n  </url>",
    );
  });
});

describe("resolveFarmAgentSitemap", () => {
  it("is off for false, on for true, and passes resolved config through", () => {
    expect(resolveFarmAgentSitemap(false).enabled).toBe(false);
    expect(resolveFarmAgentSitemap({ enabled: false, exclude: ["/a"] }).enabled).toBe(false);
    const resolved = resolveFarmAgentSitemap({ exclude: ["/admin"] });
    expect(resolveFarmAgentSitemap(resolved)).toEqual(resolved);
    expect(() => resolveFarmAgentSitemap("yes" as never)).toThrow(
      "agent.sitemap must be true, false, or an options object.",
    );
  });
});
