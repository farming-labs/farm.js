import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

import { searchParamsToObject } from "../search-params";

describe("SearchParams Parsing", () => {
  it("should parse single query parameter", () => {
    const urlSearchParams = new URLSearchParams("?tab=profile");
    const result: Record<string, string | string[] | undefined> = {};

    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });

    expect(result).toEqual({ tab: "profile" });
  });

  it("should parse multiple query parameters", () => {
    const urlSearchParams = new URLSearchParams("?tab=profile&sort=desc&page=2");
    const result: Record<string, string | string[] | undefined> = {};

    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });

    expect(result).toEqual({
      tab: "profile",
      sort: "desc",
      page: "2",
    });
  });

  it("should handle duplicate query parameters as array", () => {
    const urlSearchParams = new URLSearchParams("?tag=react&tag=typescript&tag=vite");
    const result: Record<string, string | string[] | undefined> = {};

    urlSearchParams.forEach((value, key) => {
      const existing = result[key];
      if (existing) {
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          result[key] = [existing, value];
        }
      } else {
        result[key] = value;
      }
    });

    expect(result).toEqual({
      tag: ["react", "typescript", "vite"],
    });
  });

  it("should handle URL-encoded values", () => {
    const urlSearchParams = new URLSearchParams("?name=John%20Doe&email=john%40example.com");
    const result: Record<string, string | string[] | undefined> = {};

    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });

    expect(result).toEqual({
      name: "John Doe",
      email: "john@example.com",
    });
  });

  it("should handle empty searchParams", () => {
    const urlSearchParams = new URLSearchParams("");
    const result: Record<string, string | string[] | undefined> = {};

    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });

    expect(result).toEqual({});
  });

  it("should handle parameters with empty values", () => {
    const urlSearchParams = new URLSearchParams("?tab=&sort=desc");
    const result: Record<string, string | string[] | undefined> = {};

    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });

    expect(result).toEqual({
      tab: "",
      sort: "desc",
    });
  });

  it("should handle special characters", () => {
    const urlSearchParams = new URLSearchParams("?search=hello+world&filter=price>100");
    const result: Record<string, string | string[] | undefined> = {};

    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });

    expect(result).toEqual({
      search: "hello world",
      filter: "price>100",
    });
  });

  it("should handle numeric values as strings", () => {
    const urlSearchParams = new URLSearchParams("?page=1&limit=10&price=99.99");
    const result: Record<string, string | string[] | undefined> = {};

    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });

    expect(result).toEqual({
      page: "1",
      limit: "10",
      price: "99.99",
    });
  });
});

describe("SearchParams in PageProps", () => {
  it("should provide searchParams as a Promise", async () => {
    const searchParams: Promise<Record<string, string | string[] | undefined>> = Promise.resolve({
      tab: "profile",
      sort: "desc",
    });

    const result = await searchParams;

    expect(result).toEqual({
      tab: "profile",
      sort: "desc",
    });
  });

  it("should allow destructuring after await", async () => {
    const searchParams = Promise.resolve({
      tab: "profile",
      sort: "desc",
      page: "1",
    });

    const search = await searchParams;
    const { tab, sort, page } = search;

    expect(tab).toBe("profile");
    expect(sort).toBe("desc");
    expect(page).toBe("1");
  });

  it("should handle missing search params gracefully", async () => {
    const searchParams = Promise.resolve({});
    const search = await searchParams;
    const tab = search.tab;

    expect(tab).toBeUndefined();
  });
});

describe("searchParamsToObject", () => {
  it("keeps single-value parameters as strings", () => {
    expect(searchParamsToObject(new URLSearchParams("?tab=profile&sort=desc"))).toEqual({
      tab: "profile",
      sort: "desc",
    });
  });

  it("collects repeated parameters into arrays", () => {
    expect(searchParamsToObject(new URLSearchParams("?tag=react&tag=typescript&tag=vite"))).toEqual(
      {
        tag: ["react", "typescript", "vite"],
      },
    );
  });

  it("preserves empty values when a parameter is repeated", () => {
    expect(searchParamsToObject(new URLSearchParams("?tab=&tab=x&tab="))).toEqual({
      tab: ["", "x", ""],
    });
    expect(searchParamsToObject(new URLSearchParams(""))).toEqual({});
  });
});

describe("SearchParams in the production runtime", () => {
  const readSource = (...segments: string[]) =>
    fs.readFileSync(path.join(process.cwd(), "src", ...segments), "utf-8");

  it("builds generated SSR page props with array-aware search params", () => {
    const source = readSource("nitro", "universal-build.ts");

    expect(source).toContain("  searchParamsToObject,");
    expect(source).toContain("const searchParamsObj = searchParamsToObject(url.searchParams);");
    expect(source).not.toContain("Object.fromEntries(url.searchParams.entries())");
    expect(readSource("nitro", "production-runtime.ts")).toContain(
      'export { searchParamsToObject } from "../search-params";',
    );
  });

  it("hydrates and client-navigates with array-aware search params", () => {
    const source = readSource("nitro", "universal-build.ts");

    expect(source).toContain(
      'import { createClientPluginManager, installChunkErrorRecovery, scheduleFarmIslandHydration, searchParamsToObject } from "@farm.js/core/internal/client-runtime";',
    );
    expect(source).toContain(
      "const searchParams = searchParamsToObject(new URLSearchParams(window.location.search));",
    );
    expect(source).not.toContain("Object.fromEntries(url.searchParams)");
    expect(source).not.toContain("Object.fromEntries(targetUrl.searchParams)");
    expect(source).not.toContain("Object.fromEntries(new URLSearchParams(window.location.search))");
    expect(readSource("client", "production-runtime.ts")).toContain(
      'export { searchParamsToObject } from "../search-params";',
    );
  });

  it("returns array-aware search params from the SPA page-data endpoint", () => {
    const source = readSource("nitro", "server-entry.ts");

    expect(source).toContain("const searchParams = searchParamsToObject(targetUrl.searchParams);");
    expect(source).not.toContain("const searchParams: Record<string, string> = {};");
  });

  it("shares the dev renderer's helper", () => {
    const source = readSource("server", "renderer.ts");

    expect(source).toContain('import { searchParamsToObject } from "../search-params";');
  });

  it("shares the helper with secondary production, dev navigation, and test runtimes", () => {
    const nitroSource = readSource("nitro", "index.ts");
    const viteSource = readSource("vite.ts");
    const testingSource = readSource("testing.ts");

    expect(nitroSource).toContain(
      "import { searchParamsToObject } from '@farm.js/core/internal/production-runtime';",
    );
    expect(nitroSource).toContain(
      "const searchParamsObject = searchParamsToObject(url.searchParams);",
    );
    expect(viteSource).toContain("const searchParams = searchParamsToObject(url.searchParams);");
    expect(viteSource).toContain("return searchParamsToObject(url.searchParams);");
    expect(testingSource).toContain("const search = searchParamsToObject(url.searchParams);");
  });
});
