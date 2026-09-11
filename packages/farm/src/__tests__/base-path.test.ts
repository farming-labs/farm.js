import { describe, expect, it } from "vitest";
import { applyFarmBasePath, stripFarmBasePath } from "../base-path";
import { FarmApp } from "../app";

describe("Farm base paths", () => {
  it("applies the base path only to app-relative hrefs", () => {
    expect(applyFarmBasePath("/reports", "/console")).toBe("/console/reports");
    expect(applyFarmBasePath("/console/reports", "/console")).toBe("/console/reports");
    expect(applyFarmBasePath("//cdn.example/reports", "/console")).toBe("//cdn.example/reports");
  });

  it("canonicalizes app-relative hrefs before applying the base path", () => {
    expect(applyFarmBasePath("/%2e%2e/admin?mode=edit#settings", "/console")).toBe(
      "/console/admin?mode=edit#settings",
    );
    expect(applyFarmBasePath("/reports/../admin", "/console")).toBe("/console/admin");
    expect(applyFarmBasePath("/console/%2e%2e/admin", "/console")).toBe("/console/admin");
  });

  it("rejects app-relative hrefs that browsers interpret as another origin", () => {
    expect(() => applyFarmBasePath("/\\evil.example/path", "/console")).toThrow(
      /cannot change the URL origin/,
    );
  });

  it("strips the base path without changing paths outside it", () => {
    expect(stripFarmBasePath("/console/reports", "/console")).toBe("/reports");
    expect(stripFarmBasePath("/console", "/console")).toBe("/");
    expect(stripFarmBasePath("/reports", "/console")).toBe("/reports");
  });

  it("uses the canonical base path for direct FarmApp theme cookies", () => {
    const config = new FarmApp({ basePath: " docs//guides/ ", theme: {} }).getConfig();

    expect(config.basePath).toBe("/docs/guides");
    expect(config.theme.cookiePath).toBe("/docs/guides");
  });
});
