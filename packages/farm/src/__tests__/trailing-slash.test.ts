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

  it("shares the configured preference across framework entry points", () => {
    setFarmTrailingSlashPreference(true);
    expect(getFarmTrailingSlashPreference()).toBe(true);
  });

  it("redirects a matched development page before rendering it", async () => {
    const routeManager = {
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
