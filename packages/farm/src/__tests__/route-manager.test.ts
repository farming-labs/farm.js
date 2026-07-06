import { describe, it, expect, vi, beforeEach } from "vitest";
import { RouteManager } from "../routing/route-manager";
import type { FarmConfig } from "../types";

// Mock the file system utilities
vi.mock("../utils", async () => {
  const actual = await vi.importActual("../utils");
  return {
    ...actual,
    globFiles: vi.fn(),
    resolveAppPath: vi.fn((root, ...paths) => `${root}/${paths.join("/")}`),
    logger: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

describe("RouteManager", () => {
  let routeManager: RouteManager;
  let mockConfig: Required<FarmConfig>;

  beforeEach(() => {
    mockConfig = {
      root: "/test",
      srcDir: "src",
      outDir: "dist",
      basePath: "/",
      suppressLintOnLink: false,
      experimental: {
        serverComponents: true,
        serverActions: true,
      },
      mdx: {
        markdownRoutes: true,
        className: "farm-markdown",
      },
      vite: {},
    };
    routeManager = new RouteManager(mockConfig);
  });

  describe("matchRoute", () => {
    beforeEach(async () => {
      // Mock discovered routes
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return [
            "page.tsx",
            "about/page.tsx",
            "users/page.tsx",
            "users/[id]/page.tsx",
            "blog/[...slug]/page.tsx",
          ];
        }
        if (pattern.includes("layout")) {
          return ["layout.tsx", "users/layout.tsx"];
        }
        return [];
      });

      await routeManager.discoverRoutes();
    });

    it("should match root route", () => {
      const result = routeManager.matchRoute("/");
      expect(result.route).toBeTruthy();
      expect(result.params).toEqual({});
    });

    it("should match static routes", () => {
      const result = routeManager.matchRoute("/about");
      expect(result.route).toBeTruthy();
      expect(result.params).toEqual({});
    });

    it("should match dynamic routes", () => {
      const result = routeManager.matchRoute("/users/123");
      expect(result.route).toBeTruthy();
      expect(result.params).toEqual({ id: "123" });
    });

    it("should match catch-all routes", () => {
      const result = routeManager.matchRoute("/blog/2024/01/hello-world");
      expect(result.route).toBeTruthy();
      expect(result.params).toEqual({ slug: "2024/01/hello-world" });
    });

    it("should return null for non-matching routes", () => {
      const result = routeManager.matchRoute("/non-existent");
      expect(result.route).toBeNull();
    });

    it("should find matching layouts", () => {
      const result = routeManager.matchRoute("/users/123");
      expect(result.layouts.length).toBeGreaterThan(0);
    });
  });

  describe("discoverRoutes", () => {
    it("should discover page/layout/loading/error files", async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return ["page.tsx", "about/page.tsx", "docs/page.mdx"];
        }
        if (pattern.includes("layout")) {
          return ["layout.tsx"];
        }
        if (pattern.includes("loading")) {
          return ["loading.tsx", "about/loading.tsx"];
        }
        if (pattern.includes("error")) {
          return ["error.tsx", "about/error.tsx"];
        }
        return [];
      });

      await routeManager.discoverRoutes();

      const routes = routeManager.getRoutes();
      const layouts = routeManager.getLayouts();
      const loadings = routeManager.getLoadings();
      const errors = routeManager.getErrors();

      expect(routes.size).toBe(3);
      expect(layouts.size).toBe(1);
      expect(loadings.size).toBe(2);
      expect(errors.size).toBe(2);
      expect(routes.get("/docs")?.modulePath).toBe("/test/src/app/docs/page.mdx");
    });

    it("should reject duplicate page files for one route segment", async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return ["about/page.tsx", "about/page.mdx"];
        }
        return [];
      });

      await expect(routeManager.discoverRoutes()).rejects.toThrow('Duplicate page route "/about"');
    });
  });

  describe("route-level boundaries", () => {
    beforeEach(async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return [
            "page.tsx",
            "docs/page.tsx",
            "docs/getting-started/page.tsx",
            "users/[id]/page.tsx",
          ];
        }
        if (pattern.includes("layout")) {
          return ["layout.tsx"];
        }
        if (pattern.includes("loading")) {
          return [
            "loading.tsx",
            "docs/loading.tsx",
            "docs/getting-started/loading.tsx",
            "users/[id]/loading.tsx",
          ];
        }
        if (pattern.includes("error")) {
          return ["error.tsx", "docs/error.tsx", "users/[id]/error.tsx"];
        }
        return [];
      });

      await routeManager.discoverRoutes();
    });

    it("should return nearest matching loading boundary", () => {
      const nested = routeManager.getMatchingLoading("/docs/getting-started");
      expect(nested?.route.filePath).toBe("docs/getting-started/loading.tsx");

      const parent = routeManager.getMatchingLoading("/docs/plugins");
      expect(parent?.route.filePath).toBe("docs/loading.tsx");

      const dynamic = routeManager.getMatchingLoading("/users/42/settings");
      expect(dynamic?.route.filePath).toBe("users/[id]/loading.tsx");

      const root = routeManager.getMatchingLoading("/outside/known/pages");
      expect(root?.route.filePath).toBe("loading.tsx");
    });

    it("should return nearest matching error boundary", () => {
      const docs = routeManager.getMatchingError("/docs/getting-started");
      expect(docs?.route.filePath).toBe("docs/error.tsx");

      const dynamic = routeManager.getMatchingError("/users/42/profile");
      expect(dynamic?.route.filePath).toBe("users/[id]/error.tsx");

      const root = routeManager.getMatchingError("/outside/known/pages");
      expect(root?.route.filePath).toBe("error.tsx");
    });
  });
});
