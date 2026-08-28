import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
      options: resolvePwaOptions({ offline: "/offline", cache: "recommended" }),
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
    expect(worker).toContain('const IMAGE_CACHE = "farm-pwa-images-v1"');
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
    expect(result.staticRoutes).toEqual({ "/app/offline": "offline/index.html" });
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
});

describe("generateServiceWorker", () => {
  it("only intercepts GET navigation, precached paths, and opted-in images", () => {
    const worker = generateServiceWorker({
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
});
