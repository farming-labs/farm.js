import { afterEach, describe, expect, it } from "vitest";

import { resolveDeploymentURLs } from "../environment.js";

const originalURL = process.env.CONVEX_URL;
const originalSiteURL = process.env.CONVEX_SITE_URL;

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("resolveDeploymentURLs", () => {
  afterEach(() => {
    restoreEnvironment("CONVEX_URL", originalURL);
    restoreEnvironment("CONVEX_SITE_URL", originalSiteURL);
  });

  it("tells the developer how to create CONVEX_URL when it is missing", () => {
    delete process.env.CONVEX_URL;
    expect(() => resolveDeploymentURLs({})).toThrow(/npx convex dev/);
  });

  it("reads both URLs from the environment", () => {
    process.env.CONVEX_URL = "https://happy-otter-123.convex.cloud";
    process.env.CONVEX_SITE_URL = "https://happy-otter-123.convex.site";
    expect(resolveDeploymentURLs({})).toEqual({
      url: "https://happy-otter-123.convex.cloud",
      siteURL: "https://happy-otter-123.convex.site",
    });
  });

  it("reads the VITE_ names that convex dev writes in Vite projects", () => {
    delete process.env.CONVEX_URL;
    delete process.env.CONVEX_SITE_URL;
    process.env.VITE_CONVEX_URL = "http://127.0.0.1:3212";
    process.env.VITE_CONVEX_SITE_URL = "http://127.0.0.1:3213";
    expect(resolveDeploymentURLs({})).toEqual({
      url: "http://127.0.0.1:3212",
      siteURL: "http://127.0.0.1:3213",
    });
    delete process.env.VITE_CONVEX_URL;
    delete process.env.VITE_CONVEX_SITE_URL;
  });

  it("works out the site URL of a cloud deployment", () => {
    delete process.env.CONVEX_SITE_URL;
    const urls = resolveDeploymentURLs({ url: "https://happy-otter-123.convex.cloud/" });
    expect(urls.siteURL).toBe("https://happy-otter-123.convex.site");
  });

  it("works out the site URL of a local deployment", () => {
    delete process.env.CONVEX_SITE_URL;
    const urls = resolveDeploymentURLs({ url: "http://127.0.0.1:3210" });
    expect(urls).toEqual({ url: "http://127.0.0.1:3210", siteURL: "http://127.0.0.1:3211" });
  });

  it("rejects a site URL passed as CONVEX_URL", () => {
    expect(() => resolveDeploymentURLs({ url: "https://happy-otter-123.convex.site" })).toThrow(
      /CONVEX_SITE_URL/,
    );
  });

  it("rejects a deployment URL passed as CONVEX_SITE_URL", () => {
    expect(() =>
      resolveDeploymentURLs({
        url: "https://happy-otter-123.convex.cloud",
        siteURL: "https://happy-otter-123.convex.cloud",
      }),
    ).toThrow(/HTTP actions URL/);
  });

  it("rejects a value that is not a URL", () => {
    expect(() => resolveDeploymentURLs({ url: "happy-otter-123" })).toThrow(/not a valid URL/);
  });
});
