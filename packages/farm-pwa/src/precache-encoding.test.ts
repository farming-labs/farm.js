import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writePwaBuildArtifacts } from "./build";
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

describe("precached assets with path sub-delimiter characters", () => {
  it("keys the precache with the pathname the browser actually requests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "farm-pwa-enc-"));
    temporaryDirectories.push(root);
    const publicDir = path.join(root, "public");
    await mkdir(publicDir, { recursive: true });
    // "@" is a path sub-delimiter: the bundler emits <link href="/logo@2x.css">
    // literally and the browser requests /logo@2x.css, not /logo%402x.css.
    await writeFile(path.join(publicDir, "logo@2x.css"), "body{}");
    await writeFile(path.join(publicDir, "index.html"), "<h1>Home</h1>");

    const result = await writePwaBuildArtifacts({
      outputDir: root,
      preset: "node-server",
      basePath: "/",
      options: resolvePwaOptions({ cache: "auto" }),
    });

    expect(result.precacheUrls).toContain("/logo@2x.css");
    expect(result.precacheUrls).not.toContain("/logo%402x.css");

    // The generated worker must recognize the live request path and serve it
    // from the precache rather than falling through to the network.
    const worker = await readFile(result.workerPath, "utf8");
    const cache = {
      match: vi.fn(async () => new Response("body{}", { headers: { "content-type": "text/css" } })),
      addAll: vi.fn(async () => undefined),
    };
    const listeners = new Map<string, (event: any) => void>();
    runInNewContext(worker, {
      caches: { open: vi.fn(async () => cache), keys: vi.fn(async () => []), delete: vi.fn() },
      fetch: vi.fn(async () => new Response("net")),
      Headers,
      Response,
      Request,
      URL,
      self: {
        location: { origin: "https://example.test" },
        addEventListener: (type: string, listener: (event: any) => void) =>
          listeners.set(type, listener),
        skipWaiting: () => undefined,
        clients: { claim: () => undefined },
      },
    });

    const request = new Request("https://example.test/logo@2x.css");
    let responded: Promise<Response> | undefined;
    listeners.get("fetch")!({
      request,
      respondWith: (value: Promise<Response>) => (responded = value),
      waitUntil: () => undefined,
    });

    expect(responded).toBeDefined();
    await responded;
    expect(cache.match).toHaveBeenCalled();
  });
});
