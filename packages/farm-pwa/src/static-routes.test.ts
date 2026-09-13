import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { writePwaBuildArtifacts } from "./build";
import { resolvePwaOptions } from "./config";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function output(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "farm-pwa-static-routes-"));
  directories.push(root);
  const publicDir = path.join(root, "public");
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(publicDir, file)), { recursive: true });
    await writeFile(path.join(publicDir, file), body);
  }
  return { outputDir: root, preset: "node-server", basePath: "/app" };
}

describe("static routes under a base path", () => {
  it("serves the root and a route repeating the base path as distinct pages offline", async () => {
    const input = await output({ "index.html": "home", "app/index.html": "application" });
    const result = await writePwaBuildArtifacts({
      ...input,
      options: resolvePwaOptions({ cache: "auto" }),
    });
    expect(result.staticRoutes).toEqual({ "/app": "index.html", "/app/app": "app/index.html" });
    expect(result.precacheUrls).toEqual(["/app/app/index.html", "/app/index.html"]);

    const listeners = new Map<string, (event: any) => void>();
    const cached = new Map([
      ["/app/index.html", "home"],
      ["/app/app/index.html", "application"],
    ]);
    runInNewContext(await readFile(result.workerPath, "utf8"), {
      URL,
      Set,
      caches: {
        match: async (url: string) => (cached.has(url) ? new Response(cached.get(url)) : undefined),
      },
      fetch: async () => {
        throw new Error("offline");
      },
      self: {
        location: { origin: "https://example.com" },
        addEventListener: (type: string, listener: (event: any) => void) =>
          listeners.set(type, listener),
      },
    });
    for (const [route, body] of [
      ["/app", "home"],
      ["/app/app", "application"],
    ]) {
      let response!: Promise<Response>;
      listeners.get("fetch")!({
        request: { method: "GET", mode: "navigate", url: `https://example.com${route}` },
        respondWith(value: Promise<Response>) {
          response = value;
        },
      });
      expect(await (await response).text()).toBe(body);
    }
  });

  it("treats explicit cached routes and the offline fallback as application paths", async () => {
    const input = await output({ "index.html": "home", "app/index.html": "application" });
    const result = await writePwaBuildArtifacts({
      ...input,
      options: resolvePwaOptions({ cache: { staticRoutes: ["/app"] }, offline: "/app" }),
    });
    expect(result.staticRoutes).toEqual({ "/app/app": "app/index.html" });
    expect(result.precacheUrls).toEqual(["/app/app/index.html"]);
    expect(await readFile(result.workerPath, "utf8")).toContain(
      'const OFFLINE_FILE = "/app/app/index.html"',
    );
  });

  it("preserves a repeated-base route even when no root page was emitted", async () => {
    const input = await output({ "app/index.html": "application" });
    const result = await writePwaBuildArtifacts({
      ...input,
      options: resolvePwaOptions({ cache: "auto" }),
    });
    expect(result.staticRoutes).toEqual({ "/app/app": "app/index.html" });
  });

  it.each(["offline", "staticRoutes"])(
    "does not satisfy a missing %s route with a different mounted route",
    async (kind) => {
      const input = await output({ "app/missing/index.html": "a different page" });
      const options = resolvePwaOptions(
        kind === "offline" ? { offline: "/missing" } : { cache: { staticRoutes: ["/missing"] } },
      );
      await expect(writePwaBuildArtifacts({ ...input, options })).rejects.toThrow(
        kind === "offline" ? "was not emitted" : "was not found",
      );
    },
  );

  it("strips only an explicit HTML output prefix for localized static pages", async () => {
    const input = await output({
      "app/en/index.html": "home",
      "app/en/app/index.html": "application",
    });
    const result = await writePwaBuildArtifacts({
      ...input,
      htmlBasePath: "/app",
      options: resolvePwaOptions({ cache: "auto", offline: "/en/app" }),
    });
    expect(result.staticRoutes).toEqual({
      "/app/en": "app/en/index.html",
      "/app/en/app": "app/en/app/index.html",
    });
    expect(result.precacheUrls).toEqual(["/app/en/app/index.html", "/app/en/index.html"]);
    expect(await readFile(result.workerPath, "utf8")).toContain(
      'const OFFLINE_FILE = "/app/en/app/index.html"',
    );
  });

  it("keeps already mounted assets and excludes the generated worker on rebuild", async () => {
    const input = await output({
      "index.html": "home",
      "app/_farm/search.js": "search",
      "assets/app.js": "app",
    });
    const options = resolvePwaOptions({ cache: "auto" });
    const first = await writePwaBuildArtifacts({ ...input, options });
    const second = await writePwaBuildArtifacts({ ...input, options });
    expect(second.precacheUrls).toEqual([
      "/app/_farm/search.js",
      "/app/assets/app.js",
      "/app/index.html",
    ]);
    expect(second.cacheId).toBe(first.cacheId);
  });
});
