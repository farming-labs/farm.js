// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import {
  cleanupMiddlewareProductionFixture,
  createMiddlewareProductionFixture,
} from "./fixtures/middleware-production-fixture";

describe("production middleware runtime", () => {
  it("runs farm.config middleware and app middleware in a production build", async () => {
    const root = await createMiddlewareProductionFixture();
    const originalFetch = globalThis.fetch;

    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...(userConfig || {}), root }, "production");
      await build(config, { root, preset: "vercel" });

      const staticAssetsDir = path.join(root, ".vercel", "output", "static", "assets");
      const productAssetName = (await fs.readdir(staticAssetsDir)).find((file) =>
        file.startsWith("product-"),
      );
      expect(productAssetName).toMatch(/\.png$/);
      const productAsset = await fs.readFile(path.join(staticAssetsDir, productAssetName!));
      await expect(
        fs.access(
          path.join(
            root,
            ".vercel",
            "output",
            "functions",
            "__nitro.func",
            "node_modules",
            "sharp",
            "package.json",
          ),
        ),
      ).resolves.toBeUndefined();
      globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === "https://example.test" && url.pathname.endsWith(productAssetName!)) {
          return new Response(productAsset, {
            headers: {
              "content-type": "image/png",
              "content-length": String(productAsset.byteLength),
            },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const entryPath = path.join(
        root,
        ".vercel",
        "output",
        "functions",
        "__nitro.func",
        "index.mjs",
      );
      const serverModule = await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`);
      (globalThis as any).__farmMiddlewareEvents = [];
      const response = await serverModule.default.fetch(
        new Request("https://example.test/dashboard/settings"),
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-farm-middleware")).toBe("yes");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(html).toContain(
        "production middleware: dashboard / settings / dashboard-file / /dashboard/settings",
      );
      expect(html).toContain("server context: dashboard-user / /dashboard/settings");
      expect(html).not.toContain("never-serialize-this-session-secret");
      const productImageTag = html.match(/<img[^>]*data-product-image=""[^>]*>/)?.[0];
      expect(productImageTag).toContain('alt="Optimized product"');
      expect(productImageTag).toContain('width="2"');
      expect(productImageTag).toContain('height="1"');
      expect(productImageTag).toContain("background-image:url(&quot;data:image/webp;base64");
      const optimizedImageHref = productImageTag
        ?.match(/src="([^"]+)"/)?.[1]
        .replaceAll("&amp;", "&");
      expect(optimizedImageHref).toContain("/media/image?");
      expect(optimizedImageHref).toContain("q=60");
      expect(optimizedImageHref).toContain(encodeURIComponent(`/assets/${productAssetName}`));
      const dashboardImageHref = html.match(
        /property="og:image" content="(\/dashboard\/opengraph-image\?v=[a-f0-9]{16})"/,
      )?.[1];
      expect(dashboardImageHref).toBeTruthy();
      expect(html).toContain('<meta property="og:image:width" content="2">');
      expect(html).toContain('<meta property="og:image:height" content="1">');
      expect(html).toContain('<meta property="og:image:alt" content="Dashboard preview">');
      expect((globalThis as any).__farmMiddlewareEvents.map((event: any) => event.type)).toEqual([
        "middleware.start",
        "middleware.complete",
        "middleware.start",
        "middleware.complete",
      ]);

      const staticImageResponse = await serverModule.default.fetch(
        new Request(`https://example.test${dashboardImageHref}`),
      );
      expect(staticImageResponse.status).toBe(200);
      expect(staticImageResponse.headers.get("content-type")).toBe("image/png");
      expect(staticImageResponse.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(staticImageResponse.headers.get("x-content-type-options")).toBe("nosniff");
      const staticImageEtag = staticImageResponse.headers.get("etag");
      expect(staticImageEtag).toMatch(/^"[a-f0-9]{16}"$/);
      expect((await staticImageResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);

      const staticImageHeadResponse = await serverModule.default.fetch(
        new Request(`https://example.test${dashboardImageHref}`, { method: "HEAD" }),
      );
      expect(staticImageHeadResponse.status).toBe(200);
      expect((await staticImageHeadResponse.arrayBuffer()).byteLength).toBe(0);

      const staticImageCachedResponse = await serverModule.default.fetch(
        new Request(`https://example.test${dashboardImageHref}`, {
          headers: { "if-none-match": staticImageEtag! },
        }),
      );
      expect(staticImageCachedResponse.status).toBe(304);

      const optimizedImageResponse = await serverModule.default.fetch(
        new Request(`https://example.test${optimizedImageHref}`, {
          headers: { accept: "image/webp" },
        }),
      );
      expect(optimizedImageResponse.status).toBe(200);
      expect(optimizedImageResponse.headers.get("content-type")).toBe("image/webp");
      expect(optimizedImageResponse.headers.get("vary")).toBe("Accept");
      expect((await optimizedImageResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);

      (globalThis as any).__farmMiddlewareEvents = [];
      const configResponse = await serverModule.default.fetch(
        new Request("https://example.test/dashboard/config-response"),
      );
      expect(configResponse.status).toBe(302);
      expect(configResponse.headers.get("location")).toBe("https://example.test/sign-in");
      expect((globalThis as any).__farmMiddlewareEvents.map((event: any) => event.type)).toEqual([
        "middleware.start",
        "middleware.shortCircuit",
      ]);
      expect((globalThis as any).__farmMiddlewareEvents[1]).toMatchObject({
        route: "/",
        status: 302,
      });

      (globalThis as any).__farmMiddlewareEvents = [];
      const fileResponse = await serverModule.default.fetch(
        new Request("https://example.test/dashboard/file-response"),
      );
      expect(fileResponse.status).toBe(418);
      expect(fileResponse.headers.get("x-file-response")).toBe("yes");
      expect(fileResponse.headers.get("x-farm-middleware")).toBe("yes");
      await expect(fileResponse.text()).resolves.toBe("blocked by file middleware");
      expect((globalThis as any).__farmMiddlewareEvents.map((event: any) => event.type)).toEqual([
        "middleware.start",
        "middleware.complete",
        "middleware.start",
        "middleware.shortCircuit",
      ]);
      expect((globalThis as any).__farmMiddlewareEvents[3]).toMatchObject({
        route: "/dashboard",
        status: 418,
      });

      (globalThis as any).__farmMiddlewareEvents = [];
      const userResponse = await serverModule.default.fetch(
        new Request("https://example.test/users/42/settings"),
      );
      const userHtml = await userResponse.text();
      expect(userResponse.status).toBe(200);
      expect(userHtml).toContain("user settings: 42 / 42 / 42");
      expect(userHtml).toContain('<meta property="og:image" content="/users/42/opengraph-image">');
      expect(userHtml).toContain('<meta property="og:image:alt" content="User preview">');
      expect((globalThis as any).__farmMiddlewareEvents[0]).toMatchObject({
        route: "/users/[id]",
        pathname: "/users/42/settings",
      });

      const dynamicImageResponse = await serverModule.default.fetch(
        new Request("https://example.test/users/42/opengraph-image"),
      );
      expect(dynamicImageResponse.status).toBe(200);
      expect(dynamicImageResponse.headers.get("content-type")).toBe("image/svg+xml");
      await expect(dynamicImageResponse.text()).resolves.toContain("User 42");

      const programmaticResponse = await serverModule.default.fetch(
        new Request("https://example.test/programmatic/42"),
      );
      expect(programmaticResponse.status).toBe(200);
      const programmaticHtml = await programmaticResponse.text();
      expect(programmaticHtml).toContain("production programmatic route: 42");
      expect(programmaticHtml).toMatch(
        /property="og:image" content="\/opengraph-image\?v=[a-f0-9]{16}"/,
      );

      const explicitResponse = await serverModule.default.fetch(
        new Request("https://example.test/dashboard/explicit"),
      );
      const explicitHtml = await explicitResponse.text();
      expect(explicitResponse.status).toBe(200);
      expect(explicitHtml).toContain(
        '<meta property="og:image" content="https://cdn.example.test/explicit.png">',
      );
      expect(explicitHtml).not.toMatch(/\/dashboard\/opengraph-image\?v=/);

      const programmaticApiResponse = await serverModule.default.fetch(
        new Request("https://example.test/api/programmatic/42"),
      );
      expect(programmaticApiResponse.status).toBe(200);
      await expect(programmaticApiResponse.json()).resolves.toEqual({ id: "42" });
    } finally {
      globalThis.fetch = originalFetch;
      delete (globalThis as any).__farmMiddlewareEvents;
      await cleanupMiddlewareProductionFixture(root);
    }
  }, 120_000);
});
