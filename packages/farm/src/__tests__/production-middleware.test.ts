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
import { createFarmVercelImmutableAssetRoute } from "../nitro/vercel-assets";

async function readJavaScriptOutput(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return readJavaScriptOutput(entryPath);
      return entry.name.endsWith(".mjs") ? fs.readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

function readInlineFarmProps(html: string): Record<string, any> {
  const serialized = html.match(
    /window\.__FARM_PROPS__=(.*?);window\.__FARM_INTEGRATION_API_MANIFEST__/s,
  )?.[1];
  expect(serialized).toBeTruthy();
  return JSON.parse(serialized!);
}

describe("production middleware runtime", () => {
  it("runs farm.config middleware and app middleware in a production build", async () => {
    const root = await createMiddlewareProductionFixture();
    const originalFetch = globalThis.fetch;

    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "vercel" });

      const routeRuntimeManifest = JSON.parse(
        await fs.readFile(path.join(root, ".farm", "route-runtime-manifest.json"), "utf8"),
      );
      expect(routeRuntimeManifest.routes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "metadata",
            pattern: "/sitemap.xml",
            source: "src/app/sitemap.ts",
          }),
          expect.objectContaining({
            kind: "metadata",
            pattern: "/users/[id]/sitemap.xml",
            source: "src/app/users/[id]/sitemap.ts",
          }),
        ]),
      );

      const vercelOutputConfig = JSON.parse(
        await fs.readFile(path.join(root, ".vercel", "output", "config.json"), "utf8"),
      );
      expect(vercelOutputConfig.routes[0]).toEqual(createFarmVercelImmutableAssetRoute());
      expect(vercelOutputConfig.routes[1]).toEqual({ handle: "filesystem" });

      const staticAssetsDir = path.join(root, ".vercel", "output", "static", "assets");
      // The client build emits this image under more than one hashed name, and readdir
      // order is platform dependent, so track every candidate instead of picking one.
      const productAssetNames = (await fs.readdir(staticAssetsDir))
        .filter((file) => file.startsWith("product-"))
        .sort();
      expect(productAssetNames.length).toBeGreaterThan(0);
      expect(productAssetNames.every((name) => name.endsWith(".png"))).toBe(true);
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
      await expect(
        fs.access(
          path.join(
            root,
            ".vercel",
            "output",
            "functions",
            "__nitro.func",
            "node_modules",
            "@vercel",
            "og",
            "dist",
            "Geist-Regular.ttf",
          ),
        ),
      ).resolves.toBeUndefined();
      const nitroBundle = await readJavaScriptOutput(
        path.join(root, ".vercel", "output", "functions", "__nitro.func"),
      );
      expect(nitroBundle).not.toContain("@img/sharp-");
      globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const requestedAsset = productAssetNames.find((name) => url.pathname.endsWith(name));
        if (url.origin === "https://example.test" && requestedAsset) {
          const bytes = await fs.readFile(path.join(staticAssetsDir, requestedAsset));
          return new Response(bytes, {
            headers: {
              "content-type": "image/png",
              "content-length": String(bytes.byteLength),
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
      expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
      expect(html).not.toContain("never-serialize-this-session-secret");
      const hydrationProps = readInlineFarmProps(html);
      expect(hydrationProps).toMatchObject({
        path: "/dashboard/settings",
        middleware: {
          data: {
            "config.area": "dashboard",
            "config.path": "settings",
            "file.area": "dashboard-file",
          },
        },
      });
      const hydratedMiddleware = new Map(Object.entries(hydrationProps.middleware.data));
      expect(hydratedMiddleware.get("config.area")).toBe("dashboard");
      expect(hydratedMiddleware.get("config.path")).toBe("settings");
      expect(hydratedMiddleware.get("file.area")).toBe("dashboard-file");
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
      const referencedAsset = (
        new URL(optimizedImageHref!, "https://farm.test").searchParams.get("url") ?? ""
      ).replace(/^\/assets\//, "");
      expect(productAssetNames).toContain(referencedAsset);
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
        new Request(`https://example.test${dashboardImageHref}`, {
          method: "HEAD",
        }),
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

      const sitemapResponse = await serverModule.default.fetch(
        new Request("https://example.test/sitemap.xml?campaign=spring%26summer"),
      );
      expect(sitemapResponse.status).toBe(200);
      expect(sitemapResponse.headers.get("content-type")).toBe("application/xml; charset=utf-8");
      expect(sitemapResponse.headers.get("cache-control")).toBe(
        "public, s-maxage=600, stale-while-revalidate=300",
      );
      const sitemapXml = await sitemapResponse.text();
      expect(sitemapXml).toContain("<loc>https://example.test/?campaign=spring&amp;summer</loc>");
      expect(sitemapXml).toContain("<lastmod>2026-08-16T12:00:00.000Z</lastmod>");

      const userSitemapResponse = await serverModule.default.fetch(
        new Request("https://example.test/users/42/sitemap.xml"),
      );
      expect(userSitemapResponse.status).toBe(200);
      const userSitemapXml = await userSitemapResponse.text();
      expect(userSitemapXml).toContain("<loc>https://example.test/users/42/profile</loc>");
      expect(userSitemapXml).toContain("<priority>0.42</priority>");

      const robotsResponse = await serverModule.default.fetch(
        new Request("https://example.test/robots.txt"),
      );
      expect(robotsResponse.status).toBe(200);
      expect(robotsResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      await expect(robotsResponse.text()).resolves.toContain(
        "Sitemap: https://example.test/sitemap.xml",
      );

      const manifestResponse = await serverModule.default.fetch(
        new Request("https://example.test/manifest.webmanifest"),
      );
      expect(manifestResponse.status).toBe(200);
      expect(manifestResponse.headers.get("content-type")).toBe(
        "application/manifest+json; charset=utf-8",
      );
      await expect(manifestResponse.json()).resolves.toMatchObject({
        name: "Farm production fixture",
        display: "standalone",
      });

      const manifestHeadResponse = await serverModule.default.fetch(
        new Request("https://example.test/manifest.webmanifest", { method: "HEAD" }),
      );
      expect(manifestHeadResponse.status).toBe(200);
      expect(await manifestHeadResponse.text()).toBe("");

      const metadataPostResponse = await serverModule.default.fetch(
        new Request("https://example.test/robots.txt", { method: "POST" }),
      );
      expect(metadataPostResponse.status).toBe(405);
      expect(metadataPostResponse.headers.get("allow")).toBe("GET, HEAD");

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
      expect(dynamicImageResponse.headers.get("content-type")).toBe("image/png");
      expect(dynamicImageResponse.headers.get("cache-control")).toBe(
        "public, s-maxage=120, stale-while-revalidate=300",
      );
      const dynamicImageBytes = Buffer.from(await dynamicImageResponse.arrayBuffer());
      expect(dynamicImageBytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(dynamicImageBytes.readUInt32BE(16)).toBe(1200);
      expect(dynamicImageBytes.readUInt32BE(20)).toBe(630);

      const programmaticResponse = await serverModule.default.fetch(
        new Request("https://example.test/programmatic/42"),
      );
      expect(programmaticResponse.status).toBe(200);
      const programmaticHtml = await programmaticResponse.text();
      expect(programmaticHtml).toContain("production programmatic route: 42");
      expect(programmaticHtml).toMatch(
        /property="og:image" content="\/opengraph-image\?v=[a-f0-9]{16}"/,
      );

      const tenantAResponse = await serverModule.default.fetch(
        new Request("https://example.test/context/42", {
          headers: {
            "x-farm-tenant": "tenant-a",
            "x-request-id": "request-a",
          },
        }),
      );
      expect(tenantAResponse.status).toBe(200);
      expect(tenantAResponse.headers.get("cache-control")).toBe("private, no-store");
      await expect(tenantAResponse.text()).resolves.toContain(
        "production route context: tenant-a / 42 / request-a / private",
      );

      const tenantBResponse = await serverModule.default.fetch(
        new Request("https://example.test/context/42", {
          headers: {
            "x-farm-tenant": "tenant-b",
            "x-request-id": "request-b",
          },
        }),
      );
      expect(tenantBResponse.status).toBe(200);
      expect(tenantBResponse.headers.get("cache-control")).toBe("private, no-store");
      const tenantBHtml = await tenantBResponse.text();
      expect(tenantBHtml).toContain(
        "production route context: tenant-b / 42 / request-b / private",
      );
      expect(tenantBHtml).not.toContain("tenant-a");

      for (const tenant of ["tenant-a", "tenant-b"]) {
        const pprResponse = await serverModule.default.fetch(
          new Request("https://example.test/context-ppr", {
            headers: { "x-farm-tenant": tenant },
          }),
        );
        expect(pprResponse.status).toBe(200);
        expect(pprResponse.headers.get("cache-control")).toBe("private, no-store");
        expect(pprResponse.headers.get("x-farm-ppr")).toBe("bypass");
        await expect(pprResponse.text()).resolves.toContain("configured context PPR route");
      }

      const generatedMetadataResponse = await serverModule.default.fetch(
        new Request("https://example.test/metadata/42?variant=featured"),
      );
      const generatedMetadataHtml = await generatedMetadataResponse.text();
      expect(generatedMetadataResponse.status).toBe(200);
      expect(generatedMetadataHtml).toContain("<title>Product 42 featured</title>");
      expect(generatedMetadataHtml).toContain(
        '<meta name="description" content="Layout metadata for 42">',
      );
      expect(generatedMetadataHtml).toContain('<meta property="og:title" content="Product 42">');
      expect(generatedMetadataHtml).toContain(
        '<meta property="og:description" content="Layout Open Graph metadata for 42">',
      );
      expect(generatedMetadataHtml).toContain(
        '<meta property="og:site_name" content="Farm catalog">',
      );
      expect(generatedMetadataHtml).toContain('<meta property="og:type" content="article">');

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
      await expect(programmaticApiResponse.json()).resolves.toEqual({
        id: "42",
      });

      const rewriteResponse = await serverModule.default.fetch(
        new Request("https://example.test/rewrite-alias"),
      );
      expect(rewriteResponse.status).toBe(200);
      await expect(rewriteResponse.text()).resolves.toContain("current request: /rewrite-target");
    } finally {
      globalThis.fetch = originalFetch;
      delete (globalThis as any).__farmMiddlewareEvents;
      await cleanupMiddlewareProductionFixture(root);
    }
  }, 120_000);
});
