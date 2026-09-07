import { describe, expect, it } from "vitest";
import { applyFarmBasePath, stripFarmBasePath } from "../base-path";
import { FarmApp } from "../app";

describe("Farm base paths", () => {
  it("applies the base path only to app-relative hrefs", () => {
    expect(applyFarmBasePath("/reports", "/console")).toBe("/console/reports");
    expect(applyFarmBasePath("/console/reports", "/console")).toBe("/console/reports");
    expect(applyFarmBasePath("//cdn.example/reports", "/console")).toBe("//cdn.example/reports");
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
