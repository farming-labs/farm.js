import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeBuild, evaluateLimits, extractStaticImports } from "./analyze";

describe("analyzeBuild", () => {
  it("connects emitted pages to their initial client chunks", async () => {
    const root = await createBuildFixture();
    const report = await analyzeBuild({
      root,
      distDir: ".farm",
      outputDir: path.join(root, ".farm/.output"),
      preset: "node-server",
      metric: "gzip",
    });

    expect(report.summary.pages).toBe(2);
    expect(report.pages.map((page) => page.route).sort()).toEqual(["/", "/about"]);
    const home = report.pages.find((page) => page.route === "/");
    expect(home?.assets).toEqual(["assets/entry.js", "assets/shared.js", "assets/styles.css"]);
    expect(home?.assets).not.toContain("assets/lazy.js");
    expect(report.clientAssets.find((asset) => asset.path === "assets/entry.js")?.usedByPages).toBe(
      2,
    );
    expect(report.serverAssets.map((asset) => asset.path)).toContain("index.mjs");
    expect(report.summary.client.raw).toBeGreaterThan(0);
    expect(report.summary.server.gzip).toBeGreaterThan(0);
  });

  it("reports every exceeded limit using the selected metric", async () => {
    const root = await createBuildFixture();
    const report = await analyzeBuild({
      root,
      distDir: ".farm",
      outputDir: path.join(root, ".farm/.output"),
      preset: "node-server",
      metric: "raw",
    });
    const violations = evaluateLimits(report, { page: 1, asset: 1, client: 1, server: 1 });

    expect(violations.some((violation) => violation.kind === "page")).toBe(true);
    expect(violations.some((violation) => violation.kind === "asset")).toBe(true);
    expect(violations.some((violation) => violation.kind === "client")).toBe(true);
    expect(violations.some((violation) => violation.kind === "server")).toBe(true);
    expect(violations.every((violation) => violation.metric === "raw")).toBe(true);
  });
});

describe("extractStaticImports", () => {
  it("follows static imports without charging lazy chunks to initial load", () => {
    expect(
      extractStaticImports(
        'import "./side-effect.js";import{x}from"./shared.js";export{y}from"./other.js";import("./lazy.js")',
      ),
    ).toEqual(["./side-effect.js", "./shared.js", "./other.js"]);
  });
});

async function createBuildFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-analyzer-"));
  const publicDirectory = path.join(root, ".farm/.output/public");
  const serverDirectory = path.join(root, ".farm/.output/server");
  await mkdir(path.join(publicDirectory, "assets"), { recursive: true });
  await mkdir(path.join(publicDirectory, "about"), { recursive: true });
  await mkdir(serverDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(publicDirectory, "index.html"),
      '<script type="module" src="/assets/entry.js"></script><link rel="stylesheet" href="/assets/styles.css">',
    ),
    writeFile(
      path.join(publicDirectory, "about/index.html"),
      '<script type="module" src="/docs/assets/entry.js"></script><link rel="stylesheet" href="/docs/assets/styles.css">',
    ),
    writeFile(
      path.join(publicDirectory, "assets/entry.js"),
      'import{x}from"./shared.js";import("./lazy.js");console.log(x)',
    ),
    writeFile(path.join(publicDirectory, "assets/shared.js"), "export const x = 1;"),
    writeFile(path.join(publicDirectory, "assets/lazy.js"), "export const lazy = true;"),
    writeFile(path.join(publicDirectory, "assets/styles.css"), "body{color:#123}"),
    writeFile(path.join(publicDirectory, "logo.svg"), "<svg></svg>"),
    writeFile(path.join(serverDirectory, "index.mjs"), "export default {}"),
    writeFile(path.join(serverDirectory, "index.mjs.map"), "{}"),
  ]);
  return root;
}
