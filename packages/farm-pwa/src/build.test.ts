import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { generateServiceWorker, writePwaBuildArtifacts } from "./build";
import { resolvePwaOptions } from "./config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createOutput(preset: string) {
  const root = await mkdtemp(path.join(tmpdir(), "farm-pwa-"));
  temporaryDirectories.push(root);
  const publicDir = path.join(root, preset.startsWith("vercel") ? "static" : "public");
  await mkdir(path.join(publicDir, "assets"), { recursive: true });
  await mkdir(path.join(publicDir, "offline"), { recursive: true });
  await mkdir(path.join(publicDir, "pricing"), { recursive: true });
  await writeFile(path.join(publicDir, "assets", "app.abc123.js"), "export default 1");
  await writeFile(path.join(publicDir, "assets", "app.abc123.css"), "body{}");
  await writeFile(path.join(publicDir, "assets", "ignored.map"), "{}");
  await writeFile(path.join(publicDir, "sw.js"), "old worker");
  await writeFile(path.join(publicDir, "index.html"), "<h1>Home</h1>");
  await writeFile(path.join(publicDir, "offline", "index.html"), "<h1>Offline</h1>");
  await writeFile(path.join(publicDir, "pricing", "index.html"), "<h1>Pricing</h1>");
  return { root, publicDir };
}

describe("writePwaBuildArtifacts", () => {
  it("writes a worker with static pages, an offline fallback, and SWR image caching", async () => {
    const { root, publicDir } = await createOutput("node-server");
    const result = await writePwaBuildArtifacts({
      outputDir: root,
      preset: "node-server",
      basePath: "/",
      options: resolvePwaOptions({ offline: "/offline", cache: "auto" }),
    });

    expect(result.workerPath).toBe(path.join(publicDir, "sw.js"));
    expect(result.precacheUrls).toEqual([
      "/assets/app.abc123.css",
      "/assets/app.abc123.js",
      "/index.html",
      "/offline/index.html",
      "/pricing/index.html",
    ]);
    expect(result.staticRoutes).toEqual({
      "/": "index.html",
      "/offline": "offline/index.html",
      "/pricing": "pricing/index.html",
    });

    const worker = await readFile(result.workerPath, "utf8");
    expect(worker).toMatch(/const IMAGE_CACHE = "farm-pwa-images-[0-9a-f]{16}-v1"/);
    expect(worker).toContain('"strategy":"swr","limit":100');
    expect(worker).toContain('const OFFLINE_FILE = "/offline/index.html"');
    expect(worker).toContain('event.data?.type === "FARM_PWA_SKIP_WAITING"');
    expect(worker).not.toContain("ignored.map");
    expect(result.precacheUrls).not.toContain("/sw.js");
  });

  it("uses the Vercel static output and keeps the worker under basePath", async () => {
    const { root, publicDir } = await createOutput("vercel");

    const result = await writePwaBuildArtifacts({
      outputDir: root,
      preset: "vercel",
      basePath: "/app",
      options: resolvePwaOptions({
        offline: "/offline",
        cache: { staticRoutes: false, images: false },
      }),
    });

    expect(result.workerUrl).toBe("/app/sw.js");
    expect(result.workerPath).toBe(path.join(publicDir, "app", "sw.js"));
    expect(result.precacheUrls).toEqual([
      "/app/assets/app.abc123.css",
      "/app/assets/app.abc123.js",
      "/app/offline/index.html",
    ]);
    expect(result.staticRoutes).toEqual({ "/app/offline": "offline/index.html" });
    expect(await readFile(result.workerPath, "utf8")).toContain(
      'const OFFLINE_FILE = "/app/offline/index.html"',
    );
  });

  it("copies a custom service worker verbatim under basePath", async () => {
    const { root, publicDir } = await createOutput("node-server");
    const customWorker = 'self.addEventListener("fetch", () => undefined);\n';
    await writeFile(path.join(root, "custom-worker.js"), customWorker);

    const result = await writePwaBuildArtifacts({
      root,
      outputDir: root,
      preset: "node-server",
      basePath: "/app",
      options: resolvePwaOptions({
        serviceWorker: { source: "custom-worker.js", type: "module" },
      }),
    });

    expect(result.mode).toBe("custom");
    expect(result.workerUrl).toBe("/app/sw.js");
    expect(result.precacheUrls).toEqual([]);
    expect(await readFile(path.join(publicDir, "app", "sw.js"), "utf8")).toBe(customWorker);
  });

  it("creates a missing public directory for a custom service worker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "farm-pwa-empty-output-"));
    temporaryDirectories.push(root);
    const customWorker = "self.skipWaiting();\n";
    await writeFile(path.join(root, "custom-worker.js"), customWorker);

    const result = await writePwaBuildArtifacts({
      root,
      outputDir: root,
      preset: "node-server",
      basePath: "/",
      options: resolvePwaOptions({
        serviceWorker: { source: "custom-worker.js", type: "module" },
      }),
    });

    await expect(readFile(result.workerPath, "utf8")).resolves.toBe(customWorker);
  });

  it("prefixes every logical static route without requiring basePath folders on disk", async () => {
    const { root } = await createOutput("node-server");
    const result = await writePwaBuildArtifacts({
      outputDir: root,
      preset: "node-server",
      basePath: "/app",
      options: resolvePwaOptions({ cache: { staticRoutes: true } }),
    });

    expect(result.staticRoutes).toEqual({
      "/app": "index.html",
      "/app/offline": "offline/index.html",
      "/app/pricing": "pricing/index.html",
    });
    expect(result.precacheUrls).toEqual([
      "/app/assets/app.abc123.css",
      "/app/assets/app.abc123.js",
      "/app/index.html",
      "/app/offline/index.html",
      "/app/pricing/index.html",
    ]);
  });

  it("matches static routes containing spaces and Unicode as browser pathnames", async () => {
    const { root, publicDir } = await createOutput("node-server");
    await mkdir(path.join(publicDir, "café"), { recursive: true });
    await mkdir(path.join(publicDir, "release notes"), { recursive: true });
    await writeFile(path.join(publicDir, "café", "index.html"), "<h1>Café</h1>");
    await writeFile(path.join(publicDir, "release notes", "index.html"), "<h1>Release notes</h1>");

    const result = await writePwaBuildArtifacts({
      outputDir: root,
      preset: "node-server",
      basePath: "/app",
      options: resolvePwaOptions({ offline: "/café", cache: "auto" }),
    });

    expect(result.staticRoutes).toMatchObject({
      "/app/café": "café/index.html",
      "/app/release notes": "release notes/index.html",
    });
    expect(result.precacheUrls).toContain("/app/caf%C3%A9/index.html");
    expect(result.precacheUrls).toContain("/app/release%20notes/index.html");

    const worker = await readFile(result.workerPath, "utf8");
    expect(worker).toContain('"/app/caf%C3%A9":"/app/caf%C3%A9/index.html"');
    expect(worker).toContain('"/app/release%20notes":"/app/release%20notes/index.html"');
    expect(worker).toContain('const OFFLINE_FILE = "/app/caf%C3%A9/index.html"');
  });

  it("fails the build when the offline fallback is not an emitted static page", async () => {
    const { root } = await createOutput("node-server");
    await expect(
      writePwaBuildArtifacts({
        outputDir: root,
        preset: "node-server",
        basePath: "/",
        options: resolvePwaOptions({ offline: "/missing" }),
      }),
    ).rejects.toThrow("was not emitted as a static page");
  });

  it("does not write a service worker outside publicDir through a symlinked parent", async () => {
    const { root, publicDir } = await createOutput("node-server");
    const externalDirectory = path.join(root, "external");
    const externalWorker = path.join(externalDirectory, "sw.js");
    await mkdir(externalDirectory);
    await writeFile(externalWorker, "keep me");
    await symlink(externalDirectory, path.join(publicDir, "app"), "junction");

    await expect(
      writePwaBuildArtifacts({
        outputDir: root,
        preset: "node-server",
        basePath: "/app",
        options: resolvePwaOptions(),
      }),
    ).rejects.toThrow("including through symlinks");

    await expect(readFile(externalWorker, "utf8")).resolves.toBe("keep me");
  });

  it("rejects a dangling service worker symlink before creating its external target", async () => {
    const { root, publicDir } = await createOutput("node-server");
    const externalWorker = path.join(root, "external-worker.js");
    const workerDirectory = path.join(publicDir, "app");
    await mkdir(workerDirectory);
    await symlink(externalWorker, path.join(workerDirectory, "sw.js"), "file");

    await expect(
      writePwaBuildArtifacts({
        outputDir: root,
        preset: "node-server",
        basePath: "/app",
        options: resolvePwaOptions(),
      }),
    ).rejects.toThrow("including through symlinks");

    await expect(readFile(externalWorker)).rejects.toThrow();
  });
});

describe("generateServiceWorker", () => {
  it("isolates cache names and cleanup to the service worker base path", () => {
    const createWorker = (basePath: string) =>
      generateServiceWorker({
        basePath,
        cacheId: "same-build",
        precacheUrls: [],
        staticRoutes: {},
        offlineRoute: false,
        update: "prompt",
        images: false,
      });

    const shopWorker = createWorker("/shop");
    const adminWorker = createWorker("/admin");
    const shopPrefix = shopWorker.match(/const PRECACHE_PREFIX = "([^"]+)"/)?.[1];
    const adminPrefix = adminWorker.match(/const PRECACHE_PREFIX = "([^"]+)"/)?.[1];

    expect(shopPrefix).toBeDefined();
    expect(adminPrefix).toBeDefined();
    expect(shopPrefix).not.toBe(adminPrefix);
    expect(shopWorker).toContain("name.startsWith(PRECACHE_PREFIX)");
    expect(adminWorker).toContain("name.startsWith(PRECACHE_PREFIX)");
  });

  it("only intercepts GET navigation, precached paths, and opted-in images", () => {
    const worker = generateServiceWorker({
      basePath: "/",
      cacheId: "test",
      precacheUrls: ["/assets/app.js"],
      staticRoutes: {},
      offlineRoute: false,
      update: "auto",
      images: false,
    });

    expect(worker).toContain('if (request.method !== "GET") return');
    expect(worker).toContain("url.origin !== self.location.origin");
    expect(worker).toContain("await self.skipWaiting()");
    expect(worker).toContain("if (IMAGE_OPTIONS && request.destination");
    expect(worker).toContain('request.headers.has("authorization")');
    expect(worker).toContain('policy.includes("no-cache")');
  });

  it("keeps a background image revalidation alive after returning a cached response", async () => {
    const worker = generateServiceWorker({
      basePath: "/",
      cacheId: "test",
      precacheUrls: [],
      staticRoutes: {},
      offlineRoute: false,
      update: "prompt",
      images: { strategy: "swr", limit: 10, ttlMs: 60_000 },
    });
    const listeners = new Map<string, (event: any) => void>();
    let resolveNetworkResponse!: (response: Response) => void;
    const networkResponse = new Promise<Response>((resolve) => {
      resolveNetworkResponse = resolve;
    });
    let stored = false;
    const cached = new Response("cached", {
      headers: { "x-farm-pwa-cached-at": String(Date.now()) },
    });
    const cache = {
      match: async () => cached,
      put: async () => {
        stored = true;
      },
      keys: async () => [],
    };

    runInNewContext(worker, {
      caches: { open: async () => cache },
      fetch: async () => networkResponse,
      Headers,
      Response,
      Set,
      URL,
      self: {
        addEventListener(type: string, listener: (event: any) => void) {
          listeners.set(type, listener);
        },
        clients: { claim: async () => undefined },
        location: { origin: "https://example.test" },
        skipWaiting: async () => undefined,
      },
    });

    let responsePromise!: Promise<Response>;
    let lifetimePromise!: Promise<unknown>;
    listeners.get("fetch")?.({
      request: {
        destination: "image",
        headers: new Headers(),
        method: "GET",
        mode: "cors",
        url: "https://example.test/photo.png",
      },
      respondWith(value: Promise<Response>) {
        responsePromise = value;
      },
      waitUntil(value: Promise<unknown>) {
        lifetimePromise = value;
      },
    });

    expect(lifetimePromise).toBeDefined();
    expect(await (await responsePromise).text()).toBe("cached");
    expect(stored).toBe(false);

    resolveNetworkResponse(new Response("updated", { headers: { "cache-control": "public" } }));
    await lifetimePromise;
    expect(stored).toBe(true);
  });
});
