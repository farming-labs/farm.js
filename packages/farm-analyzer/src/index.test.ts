import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analyzer } from "./index";

describe("analyzer", () => {
  it("writes HTML and JSON after a successful build", async () => {
    const root = await createMinimalOutput();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const plugin = analyzer({ output: "reports/build.html", json: true });

    await plugin.build?.after?.(
      {
        root,
        preset: "node-server",
        universal: true,
        distDir: ".farm",
        outputDir: path.join(root, ".farm/.output"),
        success: true,
      },
      {} as never,
    );

    expect(await readFile(path.join(root, "reports/build.html"), "utf8")).toContain(
      "Farm analyzer",
    );
    const json = JSON.parse(await readFile(path.join(root, "reports/build.json"), "utf8"));
    expect(json.schemaVersion).toBe(1);
    expect(json.limits.violations).toEqual([]);
    info.mockRestore();
  });

  it("fails a build when a configured limit is exceeded", async () => {
    const root = await createMinimalOutput();
    const plugin = analyzer({ output: false, limits: { asset: 1 } });

    await expect(
      plugin.build?.after?.(
        {
          root,
          preset: "node-server",
          universal: true,
          distDir: ".farm",
          outputDir: path.join(root, ".farm/.output"),
          success: true,
        },
        {} as never,
      ),
    ).rejects.toThrow("size limit exceeded");
  });

  it("does not write reports through a directory symlink outside the project", async () => {
    const root = await createMinimalOutput();
    const outside = await mkdtemp(path.join(os.tmpdir(), "farm-analyzer-outside-"));
    await symlink(
      outside,
      path.join(root, "reports"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const plugin = analyzer({ output: "reports/build.html", json: false });

    try {
      await expect(
        plugin.build?.after?.(
          {
            root,
            preset: "node-server",
            universal: true,
            distDir: ".farm",
            outputDir: path.join(root, ".farm/.output"),
            success: true,
          },
          {} as never,
        ),
      ).rejects.toThrow("after resolving symbolic links");
      await expect(readFile(path.join(outside, "build.html"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });
});

async function createMinimalOutput(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-analyzer-plugin-"));
  const publicDirectory = path.join(root, ".farm/.output/public");
  const serverDirectory = path.join(root, ".farm/.output/server");
  await mkdir(publicDirectory, { recursive: true });
  await mkdir(serverDirectory, { recursive: true });
  await writeFile(path.join(publicDirectory, "index.html"), '<script src="/entry.js"></script>');
  await writeFile(path.join(publicDirectory, "entry.js"), "console.log('farm')");
  await writeFile(path.join(serverDirectory, "index.mjs"), "export default {};");
  return root;
}

it("writes broken links before failing strict builds and accepts dynamic destinations", async () => {
  const root = await createMinimalOutput();
  try {
    const outputDir = path.join(root, ".farm/.output");
    await writeFile(
      path.join(root, ".farm/route-runtime-manifest.json"),
      JSON.stringify({
        version: 1,
        routes: [{ kind: "page", pattern: "/docs/[slug]" }],
      }),
    );
    await writeFile(
      path.join(outputDir, "public/index.html"),
      '<a href="/docs/install">valid</a><a href="/typo">missing</a><a href="#absent">fragment</a><a href="https://example.org/">external</a>',
    );
    const plugin = analyzer({ links: "strict", json: true, output: false });
    await expect(
      plugin.build?.after?.(
        {
          root,
          distDir: ".farm",
          outputDir,
          preset: "node-server",
          universal: true,
          success: true,
        },
        {} as never,
      ),
    ).rejects.toThrow("/typo");
    expect(
      JSON.parse(await readFile(path.join(root, ".farm/analyze.json"), "utf8")).brokenLinks,
    ).toEqual([
      { page: "/", href: "/typo" },
      { page: "/", href: "#absent" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
