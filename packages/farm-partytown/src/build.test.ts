import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPartytownBootstrap,
  injectPartytownBootstrap,
  normalizeBasePath,
  partytownAssetUrl,
  readPartytownDevAsset,
  writePartytownBuildArtifacts,
} from "./build.js";
import { resolvePartytownOptions } from "./config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Partytown assets", () => {
  it("creates the official bootstrap with environment defaults and forwarded calls", () => {
    const options = resolvePartytownOptions({
      forward: ["mixpanel.track"],
      fallbackTimeout: 3_000,
    });
    const development = createPartytownBootstrap(options, "/shop", true);
    const production = createPartytownBootstrap(options, "/shop", false);

    expect(development).toContain('"lib":"/shop/~partytown/"');
    expect(development).toContain('"debug":true');
    expect(development).toContain('concat(["mixpanel.track"])');
    expect(development).toContain('"fallbackTimeout":3000');
    expect(production).toContain('"debug":false');
  });

  it("copies the real worker library and emits one same-origin bootstrap", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "farm-partytown-"));
    temporaryDirectories.push(outputDir);
    const result = await writePartytownBuildArtifacts({
      outputDir,
      preset: "node-server",
      basePath: "/dashboard",
      options: resolvePartytownOptions({ forward: ["mixpanel.track"] }),
    });

    expect(result.bootstrapUrl).toBe("/dashboard/~partytown/farm-partytown.js");
    expect(await readFile(result.bootstrapPath, "utf8")).toContain("mixpanel.track");
    await expect(access(path.join(result.assetsDir, "partytown-sw.js"))).resolves.toBeUndefined();
    await expect(access(path.join(result.assetsDir, "debug"))).rejects.toThrow();
  });

  it("uses Vercel's static output and includes debug assets only when requested", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "farm-partytown-vercel-"));
    temporaryDirectories.push(outputDir);
    const result = await writePartytownBuildArtifacts({
      outputDir,
      preset: "vercel-edge",
      basePath: "/",
      options: resolvePartytownOptions({ debug: true }),
    });

    expect(result.assetsDir).toBe(path.join(outputDir, "static", "~partytown"));
    await expect(
      access(path.join(result.assetsDir, "debug", "partytown-sw.js")),
    ).resolves.toBeUndefined();
  });

  it("does not copy assets outside publicDir through a symlinked parent", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "farm-partytown-symlink-"));
    temporaryDirectories.push(outputDir);
    const publicDir = path.join(outputDir, "public");
    const externalDirectory = path.join(outputDir, "external");
    const sentinelPath = path.join(externalDirectory, "sentinel.txt");
    await mkdir(publicDir);
    await mkdir(externalDirectory);
    await writeFile(sentinelPath, "keep me");
    await symlink(externalDirectory, path.join(publicDir, "dashboard"), "junction");

    await expect(
      writePartytownBuildArtifacts({
        outputDir,
        preset: "node-server",
        basePath: "/dashboard",
        options: resolvePartytownOptions({}),
      }),
    ).rejects.toThrow("including through symlinks");

    await expect(readFile(sentinelPath, "utf8")).resolves.toBe("keep me");
    await expect(access(path.join(externalDirectory, "~partytown"))).rejects.toThrow();
  });

  it("serves only library files below the configured development path", async () => {
    const options = resolvePartytownOptions({});
    const bootstrap = await readPartytownDevAsset(
      "/app/~partytown/farm-partytown.js",
      "/app",
      options,
    );
    const worker = await readPartytownDevAsset("/app/~partytown/partytown-sw.js", "/app", options);

    expect(bootstrap?.contentType).toContain("text/javascript");
    expect(String(bootstrap?.body)).toContain('"debug":true');
    expect(worker?.body).toBeInstanceOf(Buffer);
    await expect(
      readPartytownDevAsset("/app/~partytown/%2e%2e/package.json", "/app", options),
    ).resolves.toBeUndefined();
    await expect(
      readPartytownDevAsset("/other/~partytown/partytown.js", "/app", options),
    ).resolves.toBeUndefined();
  });
});

describe("Partytown document bootstrap", () => {
  it("injects the bootstrap once at the end of head", () => {
    const html = "<!doctype html><html><head><title>Farm</title></head><body></body></html>";
    const once = injectPartytownBootstrap(html, "/~partytown/farm-partytown.js");
    const twice = injectPartytownBootstrap(once, "/~partytown/farm-partytown.js");

    expect(once).toContain(
      '<title>Farm</title><script src="/~partytown/farm-partytown.js" data-farm-partytown></script></head>',
    );
    expect(twice).toBe(once);
  });

  it("does not mistake document text or another attribute value for the marker", () => {
    const html =
      '<!doctype html><html><head><title>data-farm-partytown</title><script title="x data-farm-partytown y"></script></head><body></body></html>';

    const result = injectPartytownBootstrap(html, "/~partytown/farm-partytown.js");

    expect(result).toContain(
      '<script src="/~partytown/farm-partytown.js" data-farm-partytown></script></head>',
    );
  });

  it("leaves fragments unchanged and validates base paths", () => {
    expect(injectPartytownBootstrap("<main>Farm</main>", "/bootstrap.js")).toBe(
      "<main>Farm</main>",
    );
    expect(normalizeBasePath("/shop/")).toBe("/shop");
    expect(partytownAssetUrl("partytown.js", "/shop")).toBe("/shop/~partytown/partytown.js");
    expect(() => normalizeBasePath("/shop/../admin")).toThrow("dot path segments");
  });
});
