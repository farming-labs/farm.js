import path from "path";
import { describe, it, expect } from "vitest";
import {
  parseRoutePath,
  matchRoute,
  segmentsToPattern,
  toPosixPath,
  toRootRelativeUrlPath,
  toViteModuleId,
} from "../utils";
import { createCliColors } from "../cli-colors";

describe("createCliColors", () => {
  it("emits ANSI styles for interactive terminals", () => {
    expect(createCliColors(true).green("Farm.js")).toContain("\u001b[32m");
  });

  it("keeps redirected output plain", () => {
    expect(createCliColors(false).green("Farm.js")).toBe("Farm.js");
  });
});

describe("toViteModuleId", () => {
  it("uses root URLs for project files and /@fs URLs for external files", () => {
    const root = path.resolve("/workspace/app");

    expect(toViteModuleId(path.join(root, "src", "farm.routes.tsx"), root)).toBe(
      "/src/farm.routes.tsx",
    );
    expect(toViteModuleId(path.resolve("/workspace/layer/routes.ts"), root)).toBe(
      "/@fs/workspace/layer/routes.ts",
    );
    expect(toViteModuleId("virtual:farm-routes", root)).toBe("virtual:farm-routes");
  });
});

describe("toPosixPath", () => {
  it("normalizes Windows separators and leaves POSIX paths alone", () => {
    expect(toPosixPath("E:\\farming\\app\\.farm\\.nitro\\farm-workflows\\http-handler.mjs")).toBe(
      "E:/farming/app/.farm/.nitro/farm-workflows/http-handler.mjs",
    );
    expect(toPosixPath("/workspace/app/.farm/.nitro/nitro-entry.mjs")).toBe(
      "/workspace/app/.farm/.nitro/nitro-entry.mjs",
    );
  });
});

describe("toRootRelativeUrlPath", () => {
  it("slices POSIX project paths to root-relative URL paths", () => {
    expect(toRootRelativeUrlPath("/workspace/app/src/app/page.tsx", "/workspace/app")).toBe(
      "/src/app/page.tsx",
    );
  });

  it("emits forward slashes for Windows project paths", () => {
    // The client feeds these values to dynamic import(); `\src\app\page.tsx`
    // is not a valid module specifier and breaks hydration on Windows.
    expect(toRootRelativeUrlPath("E:\\farming\\app\\src\\app\\page.tsx", "E:\\farming\\app")).toBe(
      "/src/app/page.tsx",
    );
    expect(
      toRootRelativeUrlPath("E:\\farming\\app\\src\\app\\layout.tsx", "E:\\farming\\app"),
    ).toBe("/src/app/layout.tsx");
  });

  it("returns undefined for paths outside the root", () => {
    expect(toRootRelativeUrlPath("/other/place/page.tsx", "/workspace/app")).toBeUndefined();
    expect(toRootRelativeUrlPath("D:\\elsewhere\\page.tsx", "E:\\farming\\app")).toBeUndefined();
    expect(toRootRelativeUrlPath("virtual:farm-routes", "/workspace/app")).toBeUndefined();
  });

  it("does not treat sibling directories sharing a prefix as inside the root", () => {
    expect(toRootRelativeUrlPath("/workspace/app2/src/page.tsx", "/workspace/app")).toBeUndefined();
  });

  it("returns an empty path for the root itself", () => {
    expect(toRootRelativeUrlPath("/workspace/app", "/workspace/app")).toBe("");
  });
});

describe("parseRoutePath", () => {
  it("should parse static routes", () => {
    const result = parseRoutePath("about/page.tsx");
    expect(result.segments).toEqual([
      { segment: "about", isDynamic: false, isOptional: false, isCatchAll: false },
    ]);
    expect(result.type).toBe("page");
  });

  it("should parse dynamic routes", () => {
    const result = parseRoutePath("users/[id]/page.tsx");
    expect(result.segments).toEqual([
      { segment: "users", isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: "id", isDynamic: true, isOptional: false, isCatchAll: false },
    ]);
  });

  it("should parse catch-all routes", () => {
    const result = parseRoutePath("blog/[...slug]/page.tsx");
    expect(result.segments).toEqual([
      { segment: "blog", isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: "slug", isDynamic: true, isOptional: false, isCatchAll: true },
    ]);
  });

  it("should parse optional catch-all routes", () => {
    const result = parseRoutePath("docs/[[...slug]]/page.tsx");
    expect(result.segments).toEqual([
      { segment: "docs", isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: "slug", isDynamic: true, isOptional: true, isCatchAll: true },
    ]);
  });

  it("should parse root page", () => {
    const result = parseRoutePath("page.tsx");
    expect(result.segments).toEqual([]);
    expect(result.type).toBe("page");
  });

  it("should identify layout files", () => {
    const result = parseRoutePath("about/layout.tsx");
    expect(result.type).toBe("layout");
  });

  it("should strip route group segments from the URL", () => {
    expect(parseRoutePath("(marketing)/page.tsx").segments).toEqual([]);
    expect(parseRoutePath("(marketing)/pricing/page.tsx").segments).toEqual([
      { segment: "pricing", isDynamic: false, isOptional: false, isCatchAll: false },
    ]);
    expect(parseRoutePath("(shop)/products/[id]/page.tsx").segments).toEqual([
      { segment: "products", isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: "id", isDynamic: true, isOptional: false, isCatchAll: false },
    ]);
  });

  it("should keep interception marker segments intact", () => {
    expect(parseRoutePath("feed/(.)photo/page.tsx").segments).toEqual([
      { segment: "feed", isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: "(.)photo", isDynamic: false, isOptional: false, isCatchAll: false },
    ]);
  });
});

describe("matchRoute", () => {
  it("should match static routes", () => {
    const segments = [{ segment: "about", isDynamic: false, isOptional: false, isCatchAll: false }];
    const result = matchRoute("/about", segments);
    expect(result.matches).toBe(true);
    expect(result.params).toEqual({});
  });

  it("should match dynamic routes", () => {
    const segments = [
      { segment: "users", isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: "id", isDynamic: true, isOptional: false, isCatchAll: false },
    ];
    const result = matchRoute("/users/123", segments);
    expect(result.matches).toBe(true);
    expect(result.params).toEqual({ id: "123" });
  });

  it("should match dynamic segments containing dots", () => {
    const segments = [
      { segment: "user", isDynamic: true, isOptional: false, isCatchAll: false },
      { segment: "repo", isDynamic: true, isOptional: false, isCatchAll: false },
    ];
    const result = matchRoute("/kinfish/farm.js", segments);
    expect(result.matches).toBe(true);
    expect(result.params).toEqual({ user: "kinfish", repo: "farm.js" });
  });

  it("should match catch-all routes", () => {
    const segments = [
      { segment: "blog", isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: "slug", isDynamic: true, isOptional: false, isCatchAll: true },
    ];
    const result = matchRoute("/blog/2024/01/hello-world", segments);
    expect(result.matches).toBe(true);
    expect(result.params).toEqual({ slug: "2024/01/hello-world" });
  });

  it("should match optional catch-all routes with no params", () => {
    const segments = [
      { segment: "docs", isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: "slug", isDynamic: true, isOptional: true, isCatchAll: true },
    ];
    const result = matchRoute("/docs", segments);
    expect(result.matches).toBe(true);
    expect(result.params).toEqual({ slug: "" });
  });

  it("should not match incorrect routes", () => {
    const segments = [{ segment: "about", isDynamic: false, isOptional: false, isCatchAll: false }];
    const result = matchRoute("/contact", segments);
    expect(result.matches).toBe(false);
  });

  it("should match root route", () => {
    const result = matchRoute("/", []);
    expect(result.matches).toBe(true);
    expect(result.params).toEqual({});
  });
});

describe("segmentsToPattern", () => {
  it("should convert static segments to pattern", () => {
    const segments = [{ segment: "about", isDynamic: false, isOptional: false, isCatchAll: false }];
    const pattern = segmentsToPattern(segments);
    expect(pattern).toBe("/about");
  });

  it("should convert dynamic segments to pattern", () => {
    const segments = [
      { segment: "users", isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: "id", isDynamic: true, isOptional: false, isCatchAll: false },
    ];
    const pattern = segmentsToPattern(segments);
    expect(pattern).toBe("/users/:id");
  });

  it("should convert catch-all segments to pattern", () => {
    const segments = [
      { segment: "blog", isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: "slug", isDynamic: true, isOptional: false, isCatchAll: true },
    ];
    const pattern = segmentsToPattern(segments);
    expect(pattern).toBe("/blog/*slug");
  });

  it("should handle empty segments (root)", () => {
    const pattern = segmentsToPattern([]);
    expect(pattern).toBe("/");
  });
});
