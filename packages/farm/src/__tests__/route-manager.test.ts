import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RouteManager, shouldSuggestStaticRenderingForI18n } from "../routing/route-manager";
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
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

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

    it("prefers exact and more specific dynamic routes regardless of discovery order", async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return ["[slug]/page.tsx", "docs/[[...parts]]/page.tsx", "about/page.tsx"];
        }
        return [];
      });
      await routeManager.discoverRoutes();

      expect(routeManager.matchRoute("/about/").route?.pattern).toBe("/about");
      expect(routeManager.matchRoute("/docs").route?.pattern).toBe("/docs/[[...parts]]");
      expect(routeManager.matchRoute("/docs/routing/production").route?.pattern).toBe(
        "/docs/[[...parts]]",
      );
      expect(routeManager.matchRoute("/contact").route?.pattern).toBe("/[slug]");
    });
  });

  describe("discoverRoutes", () => {
    it("uses renderer component extensions for route discovery", async () => {
      const { globFiles } = await import("../utils");
      mockConfig.renderer = {
        name: "vue",
        vite: "@farm.js/vue/vite",
        server: "@farm.js/vue/server",
        client: "@farm.js/vue/client",
        componentExtensions: [".vue"],
      };
      routeManager = new RouteManager(mockConfig);
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) return ["page.vue"];
        if (pattern.includes("layout")) return ["layout.vue"];
        return [];
      });

      await routeManager.discoverRoutes();

      expect(vi.mocked(globFiles).mock.calls.some(([pattern]) => pattern.includes("vue"))).toBe(
        true,
      );
      expect(routeManager.getRoutes().get("/")?.modulePath).toBe("/test/src/app/page.vue");
      expect(routeManager.getLayouts().get("/")?.modulePath).toBe("/test/src/app/layout.vue");
    });

    it("reuses compiled navigation metadata until route discovery invalidates it", async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) return ["page.tsx", "about/page.tsx"];
        if (pattern.includes("layout")) return ["layout.tsx"];
        return [];
      });

      await routeManager.discoverRoutes();
      const first = routeManager.generateClientManifest(mockConfig.root);
      const cached = routeManager.generateClientManifest(mockConfig.root);

      expect(cached).toBe(first);

      await routeManager.discoverRoutes();
      const refreshed = routeManager.generateClientManifest(mockConfig.root);

      expect(refreshed).not.toBe(first);
      expect(new Set(refreshed.routes.map((route) => route.pattern))).toEqual(
        new Set(["/", "/about"]),
      );
    });

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

    it("uses page.md as the markdown representation beside page.tsx", async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return ["about/page.tsx", "about/page.md"];
        }
        return [];
      });

      await routeManager.discoverRoutes();

      expect(routeManager.getRoutes().get("/about")).toMatchObject({
        modulePath: "/test/src/app/about/page.tsx",
        markdownSourcePath: "/test/src/app/about/page.md",
      });
    });

    it("rejects multiple component pages for one route segment", async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return ["about/page.tsx", "about/page.jsx"];
        }
        return [];
      });

      await expect(routeManager.discoverRoutes()).rejects.toThrow('Duplicate page route "/about"');
    });

    it("rejects ambiguous markdown representations for one page", async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return ["about/page.tsx", "about/page.md", "about/page.mdx"];
        }
        return [];
      });

      await expect(routeManager.discoverRoutes()).rejects.toThrow(
        'Duplicate markdown representation for page route "/about"',
      );
    });

    it("requires an intercepted URL to have a canonical page", async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return ["feed/page.tsx", "feed/@modal/(.)photo/[id]/page.tsx"];
        }
        if (pattern.includes("layout")) {
          return ["feed/layout.tsx"];
        }
        return [];
      });

      await expect(routeManager.discoverRoutes()).rejects.toThrow(
        'targets "/feed/photo/[id]", but no canonical page exists',
      );
    });
  });

  describe("named route slots", () => {
    beforeEach(async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return [
            "feed/page.tsx",
            "feed/photo/[id]/page.tsx",
            "feed/@activity/page.tsx",
            "feed/@modal/(.)photo/[id]/page.tsx",
          ];
        }
        if (pattern.includes("default")) {
          return ["feed/@modal/default.tsx"];
        }
        if (pattern.includes("layout")) {
          return ["layout.tsx", "feed/layout.tsx"];
        }
        return [];
      });

      await routeManager.discoverRoutes();
    });

    it("keeps slot pages out of the canonical page map", () => {
      expect(routeManager.getRoutes().size).toBe(2);
      expect(routeManager.getRouteSlots().size).toBe(3);
    });

    it("matches ordinary slot content and default fallbacks", () => {
      const match = routeManager.matchRoute("/feed");

      expect(match.slots.map((slot) => [slot.name, slot.fallback])).toEqual([
        ["activity", false],
        ["modal", true],
      ]);
    });

    it("uses an interception only when navigation provides a background route", () => {
      const direct = routeManager.matchRoute("/feed/photo/42");
      const intercepted = routeManager.matchRoute("/feed/photo/42", {
        interceptFrom: "/feed",
      });

      expect(direct.slots.find((slot) => slot.name === "modal")?.fallback).toBe(true);
      expect(intercepted.slots.find((slot) => slot.name === "modal")).toMatchObject({
        interception: true,
        fallback: false,
        params: { id: "42" },
      });
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

  describe("metadata image routes", () => {
    it("discovers and matches opengraph-image and twitter-image files", async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) {
          return ["page.tsx", "blog/[slug]/page.tsx"];
        }
        if (pattern.includes("opengraph-image")) {
          return [
            "opengraph-image.tsx",
            "blog/[slug]/opengraph-image.tsx",
            "blog/[slug]/twitter-image.tsx",
          ];
        }
        return [];
      });

      await routeManager.discoverRoutes();

      expect(routeManager.getMetadataImages().size).toBe(3);

      const exact = routeManager.matchMetadataImage("/blog/farm/opengraph-image");
      expect(exact?.image.pattern).toBe("/blog/[slug]");
      expect(exact?.params).toEqual({ slug: "farm" });
      expect(exact?.pagePath).toBe("/blog/farm");

      const nearest = routeManager.getMatchingMetadataImage("/blog/farm/comments", "opengraph");
      expect(nearest?.image.pattern).toBe("/blog/[slug]");
      expect(routeManager.resolveMetadataImagePath(nearest!.image, nearest!.params)).toBe(
        "/blog/farm/opengraph-image",
      );

      const twitter = routeManager.getMatchingMetadataImage("/blog/farm", "twitter");
      expect(twitter?.image.pattern).toBe("/blog/[slug]");
      expect(routeManager.resolveMetadataImagePath(twitter!.image, twitter!.params)).toBe(
        "/blog/farm/twitter-image",
      );
    });

    it("discovers static images and fingerprints their public route", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "farm-static-route-"));
      temporaryDirectories.push(root);
      const appDirectory = path.join(root, "src", "app");
      await mkdir(path.join(appDirectory, "about"), { recursive: true });
      await writeFile(
        path.join(appDirectory, "about", "opengraph-image.png"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR42mNk+M/wHwAF/gL+X5WvWQAAAABJRU5ErkJggg==",
          "base64",
        ),
      );

      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) return ["about/page.tsx"];
        if (pattern.includes("opengraph-image")) return ["about/opengraph-image.png"];
        return [];
      });

      const manager = new RouteManager({ ...mockConfig, root });
      await manager.discoverRoutes();

      const match = manager.getMatchingMetadataImage("/about", "opengraph");
      expect(match?.image.sourceType).toBe("static");
      expect(match?.image.staticInfo).toMatchObject({
        contentType: "image/png",
        width: 2,
        height: 1,
      });
      expect(manager.resolveMetadataImagePath(match!.image)).toMatch(
        /^\/about\/opengraph-image\?v=[a-f0-9]{16}$/,
      );
    });

    it("rejects a static image and module in the same route segment", async () => {
      const { globFiles } = await import("../utils");
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes("page")) return ["about/page.tsx"];
        if (pattern.includes("opengraph-image")) {
          return ["about/opengraph-image.tsx", "about/opengraph-image.png"];
        }
        return [];
      });

      await expect(routeManager.discoverRoutes()).rejects.toThrow(
        'Duplicate opengraph-image route "/about"',
      );
    });
  });
});

describe("static rendering suggestions with i18n", () => {
  it("only suggests static rendering when locale selection is URL-stable", () => {
    expect(shouldSuggestStaticRenderingForI18n(undefined)).toBe(true);
    expect(
      shouldSuggestStaticRenderingForI18n({
        routing: "prefix-always",
        detection: ["cookie", "accept-language"],
      }),
    ).toBe(true);
    expect(
      shouldSuggestStaticRenderingForI18n({
        routing: "prefix-except-default",
        detection: ["url"],
      }),
    ).toBe(true);
    expect(
      shouldSuggestStaticRenderingForI18n({
        routing: "prefix-except-default",
        detection: ["url", "cookie"],
      }),
    ).toBe(false);
    expect(
      shouldSuggestStaticRenderingForI18n({
        routing: "none",
        detection: ["url"],
      }),
    ).toBe(false);
  });
});
