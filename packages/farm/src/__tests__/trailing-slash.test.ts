import { afterEach, describe, expect, it } from "vitest";
import {
  getFarmTrailingSlashPreference,
  normalizeFarmTrailingSlashPathname,
  resolveFarmTrailingSlashRedirect,
  setFarmTrailingSlashPreference,
} from "../trailing-slash";
import { ServerRenderer } from "../server/renderer";

afterEach(() => {
  setFarmTrailingSlashPreference(false);
});

describe("trailing slash routing", () => {
  it("normalizes non-root page paths in both modes", () => {
    expect(normalizeFarmTrailingSlashPathname("/about", true)).toBe("/about/");
    expect(normalizeFarmTrailingSlashPathname("/about/", true)).toBe("/about/");
    expect(normalizeFarmTrailingSlashPathname("/about/", false)).toBe("/about");
    expect(normalizeFarmTrailingSlashPathname("/", true)).toBe("/");
  });

  it("preserves the request query in canonical redirects", () => {
    expect(
      resolveFarmTrailingSlashRedirect(new URL("https://farm.test/about?tab=team"), true),
    ).toBe("/about/?tab=team");
    expect(
      resolveFarmTrailingSlashRedirect(new URL("https://farm.test/about/?tab=team"), false),
    ).toBe("/about?tab=team");
    expect(resolveFarmTrailingSlashRedirect(new URL("https://farm.test/about/"), true)).toBeNull();
  });

  it("keeps canonical redirects on the request origin when the path repeats leading slashes", () => {
    // A root-level dynamic route matches "//evil.com/" because empty segments are skipped, so
    // the canonical Location must not become the protocol-relative URL "//evil.com".
    const cases: Array<[string, boolean, string]> = [
      ["https://farm.test//evil.com/", false, "/evil.com"],
      ["https://farm.test/\\evil.com/", false, "/evil.com"],
      ["https://farm.test///evil.com/", false, "/evil.com"],
      ["https://farm.test//evil.com/?x=1", false, "/evil.com?x=1"],
      ["https://farm.test//evil.com", true, "/evil.com/"],
      ["https://farm.test/\\evil.com", true, "/evil.com/"],
      ["https://farm.test//evil.com/about", true, "/evil.com/about/"],
      ["https://farm.test//", false, "/"],
    ];
    for (const [href, enabled, location] of cases) {
      expect(resolveFarmTrailingSlashRedirect(new URL(href), enabled), href).toBe(location);
    }
  });

  it("does not redirect a repeated leading slash whose trailing slash is already canonical", () => {
    // These were served as they are before, and still are: there is no Location to protect.
    for (const [href, enabled] of [
      ["https://farm.test//dashboard/projects/7", false],
      ["https://farm.test//evil.com", false],
      ["https://farm.test//evil.com/", true],
      ["https://farm.test//", true],
    ] as const) {
      expect(resolveFarmTrailingSlashRedirect(new URL(href), enabled), href).toBeNull();
    }
  });

  it("leaves interior repeated slashes and already-canonical paths alone", () => {
    expect(resolveFarmTrailingSlashRedirect(new URL("https://farm.test/a//b/"), false)).toBe(
      "/a//b",
    );
    expect(resolveFarmTrailingSlashRedirect(new URL("https://farm.test/a//b/"), true)).toBeNull();
    expect(resolveFarmTrailingSlashRedirect(new URL("https://farm.test/about"), false)).toBeNull();
    expect(resolveFarmTrailingSlashRedirect(new URL("https://farm.test/"), true)).toBeNull();
  });

  it("shares the configured preference across framework entry points", () => {
    setFarmTrailingSlashPreference(true);
    expect(getFarmTrailingSlashPreference()).toBe(true);
  });

  it("redirects a matched development page before rendering it", async () => {
    const routeManager = {
      toRoutePathname: (pathname: string) => pathname,
      matchMetadataRoute: () => null,
      matchMetadataImage: () => null,
      matchRoute: () => ({
        route: { pattern: "/about" },
        params: {},
        layouts: [],
        slots: [],
      }),
    };
    const renderer = new ServerRenderer(
      {
        root: process.cwd(),
        outDir: ".farm-test-missing",
        basePath: "/",
        deploymentId: "test",
        trailingSlash: true,
      } as any,
      routeManager as any,
    );
    (renderer as any).initialize = async () => undefined;

    const headers = new Map<string, unknown>();
    const response = {
      statusCode: 200,
      setHeader: (name: string, value: unknown) => headers.set(name, value),
      getHeader: (name: string) => headers.get(name),
      end: () => undefined,
    };

    await renderer.renderPage(
      {
        method: "GET",
        url: "/about?tab=team",
        headers: { host: "farm.test" },
      } as any,
      response as any,
    );

    expect(response.statusCode).toBe(308);
    expect(headers.get("Location")).toBe("/about/?tab=team");
  });
});
