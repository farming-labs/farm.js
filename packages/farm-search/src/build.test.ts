import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  matchesRoutePattern,
  resolveSearchPublicDir,
  routeFromHtmlFile,
  writeSearchIndex,
} from "./build";
import { resolveSearchOptions } from "./config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe.sequential("writeSearchIndex", () => {
  it("creates a real Pagefind bundle from selected static pages", async () => {
    const { outputDir, publicDir } = await createOutput();
    await mkdir(path.join(publicDir, "docs"), { recursive: true });
    await mkdir(path.join(publicDir, "account"), { recursive: true });
    await writeFile(path.join(publicDir, "index.html"), page("Home", "Farm home"));
    await writeFile(
      path.join(publicDir, "docs", "index.html"),
      page("Server functions", "Typed server functions and authorization"),
    );
    await writeFile(
      path.join(publicDir, "account", "index.html"),
      page("Account", "Private billing settings"),
    );
    const stalePath = path.join(publicDir, "app", "_farm", "search", "stale.txt");
    await mkdir(path.dirname(stalePath), { recursive: true });
    await writeFile(stalePath, "stale");

    const result = await writeSearchIndex({
      outputDir,
      publicDir,
      preset: "node-server",
      basePath: "/app",
      options: resolveSearchOptions({
        include: ["/", "/docs/**"],
        exclude: ["/account/**"],
      }),
    });

    expect(result.indexedRoutes).toEqual(["/app", "/app/docs"]);
    expect(result.skippedRoutes).toEqual(["/app/account"]);
    expect(result.bundlePath).toBe("/app/_farm/search/");
    expect(result.outputPath).toBe(path.join(publicDir, "app", "_farm", "search"));
    await expect(access(path.join(result.outputPath, "pagefind.js"))).resolves.toBeUndefined();
    await expect(access(stalePath)).rejects.toThrow();
    expect(await readFile(path.join(result.outputPath, "pagefind.js"), "utf8")).toContain(
      "Pagefind",
    );
  }, 30_000);

  it("fails clearly when no emitted page matches", async () => {
    const { outputDir, publicDir } = await createOutput();
    await writeFile(path.join(publicDir, "index.html"), page("Home", "Farm home"));

    await expect(
      writeSearchIndex({
        outputDir,
        publicDir,
        preset: "node-server",
        basePath: "/",
        options: resolveSearchOptions({ include: ["/docs/**"] }),
      }),
    ).rejects.toThrow("No static HTML pages matched");
  });

  it("keeps application routes that repeat basePath distinct and filters before prefixing", async () => {
    const { outputDir, publicDir } = await createOutput();
    for (const route of ["", "app", "app/app", "app/private"]) {
      await mkdir(path.join(publicDir, route), { recursive: true });
      await writeFile(
        path.join(publicDir, route, "index.html"),
        page(route || "Home", "Searchable content"),
      );
    }
    const input = { outputDir, publicDir, preset: "node-server", basePath: "/app" };
    const result = await writeSearchIndex({
      ...input,
      options: resolveSearchOptions({ exclude: ["/app/private"] }),
    });
    expect(result.indexedRoutes).toEqual(["/app", "/app/app", "/app/app/app"]);
    expect(result.skippedRoutes).toEqual(["/app/app/private"]);

    const rootOnly = await writeSearchIndex({
      ...input,
      options: resolveSearchOptions({ include: ["/"] }),
    });
    expect(rootOnly.indexedRoutes).toEqual(["/app"]);
    expect(rootOnly.skippedRoutes).toEqual(["/app/app", "/app/app/app", "/app/app/private"]);
  }, 30_000);

  it("does not guess the HTML path prefix from a matching directory without a home page", async () => {
    const { outputDir, publicDir } = await createOutput();
    await mkdir(path.join(publicDir, "app"), { recursive: true });
    await writeFile(path.join(publicDir, "app", "index.html"), page("App", "Searchable app"));
    const result = await writeSearchIndex({
      outputDir,
      publicDir,
      preset: "node-server",
      basePath: "/app",
      options: resolveSearchOptions({ include: ["/app"] }),
    });
    expect(result.indexedRoutes).toEqual(["/app/app"]);
  }, 30_000);

  it("strips only the explicit HTML base path for already-prefixed output", async () => {
    const { outputDir, publicDir } = await createOutput();
    for (const route of ["app", "app/app", "app/app/private"]) {
      await mkdir(path.join(publicDir, route), { recursive: true });
      await writeFile(path.join(publicDir, route, "index.html"), page(route, "Searchable content"));
    }
    const result = await writeSearchIndex({
      outputDir,
      publicDir,
      preset: "vercel",
      basePath: "/app",
      htmlBasePath: "/app",
      options: resolveSearchOptions({ exclude: ["/app/private"] }),
    });
    expect(result.indexedRoutes).toEqual(["/app", "/app/app"]);
    expect(result.skippedRoutes).toEqual(["/app/app/private"]);
  }, 30_000);

  it("mounts a custom bundle directory beneath basePath even when its name repeats it", async () => {
    const { outputDir, publicDir } = await createOutput();
    await writeFile(path.join(publicDir, "index.html"), page("Home", "Searchable home"));
    const result = await writeSearchIndex({
      outputDir,
      publicDir,
      preset: "node-server",
      basePath: "/app",
      options: resolveSearchOptions({ output: "app/search" }),
    });
    expect(result.bundlePath).toBe("/app/app/search/");
    await expect(
      access(path.join(publicDir, "app", "app", "search", "pagefind.js")),
    ).resolves.toBeUndefined();
  }, 30_000);

  it("does not delete or write outside publicDir through a symlinked output parent", async () => {
    const { root, outputDir, publicDir } = await createOutput();
    const externalDir = path.join(root, "external");
    const externalSearchDir = path.join(externalDir, "_farm", "search");
    const sentinelPath = path.join(externalSearchDir, "sentinel.txt");
    await mkdir(externalSearchDir, { recursive: true });
    await writeFile(sentinelPath, "keep me");
    await writeFile(path.join(publicDir, "index.html"), page("Home", "Farm home"));
    await symlink(externalDir, path.join(publicDir, "app"), "junction");

    await expect(
      writeSearchIndex({
        outputDir,
        publicDir,
        preset: "node-server",
        basePath: "/app",
        options: resolveSearchOptions(),
      }),
    ).rejects.toThrow("including through symlinks");

    await expect(readFile(sentinelPath, "utf8")).resolves.toBe("keep me");
    await expect(access(path.join(externalSearchDir, "pagefind.js"))).rejects.toThrow();
  });

  it("rejects a dangling symlink in the output path", async () => {
    const { root, outputDir, publicDir } = await createOutput();
    const externalDir = path.join(root, "missing-external");
    await writeFile(path.join(publicDir, "index.html"), page("Home", "Farm home"));
    await symlink(externalDir, path.join(publicDir, "app"), "junction");

    await expect(
      writeSearchIndex({
        outputDir,
        publicDir,
        preset: "node-server",
        basePath: "/app",
        options: resolveSearchOptions(),
      }),
    ).rejects.toThrow("including through symlinks");

    await expect(access(externalDir)).rejects.toThrow();
  });
});

describe("search route matching", () => {
  it("maps static output files to clean routes", () => {
    expect(routeFromHtmlFile("index.html")).toBe("/");
    expect(routeFromHtmlFile("docs/index.html")).toBe("/docs");
    expect(routeFromHtmlFile("legal.html")).toBe("/legal");
    expect(routeFromHtmlFile("docs\\api\\index.html")).toBe("/docs/api");
  });

  it("matches parent routes, descendants, segments, and single characters", () => {
    expect(matchesRoutePattern("/docs", "/docs/**")).toBe(true);
    expect(matchesRoutePattern("/docs/api/routes", "/docs/**")).toBe(true);
    expect(matchesRoutePattern("/blog/post", "/blog/*")).toBe(true);
    expect(matchesRoutePattern("/blog/2026/post", "/blog/*")).toBe(false);
    expect(matchesRoutePattern("/v1", "/v?")).toBe(true);
  });

  it("uses Vercel's static directory after deployment post-processing", () => {
    expect(resolveSearchPublicDir("/output", "vercel")).toBe(path.join("/output", "static"));
    expect(resolveSearchPublicDir("/output", "vercel-edge")).toBe(path.join("/output", "static"));
    expect(resolveSearchPublicDir("/output", "node-server")).toBe(path.join("/output", "public"));
  });
});

async function createOutput() {
  const root = await mkdtemp(path.join(tmpdir(), "farm-search-"));
  temporaryDirectories.push(root);
  const outputDir = path.join(root, ".farm", ".output");
  const publicDir = path.join(outputDir, "public");
  await mkdir(publicDir, { recursive: true });
  return { root, outputDir, publicDir };
}

function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${content}</p></main></body></html>`;
}
