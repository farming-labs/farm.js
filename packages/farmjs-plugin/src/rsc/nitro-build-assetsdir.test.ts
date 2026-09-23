import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRscNitro } from "./nitro-build";

const SSR_FIXTURE = [
  `const CLIENT_CSS_HREF = "__FARM_CLIENT_CSS_HREF__";`,
  `const PLACEHOLDER_CSS_HREF = "__FARM_CLIENT_CSS_HREF__";`,
  `const resolvedCssHref =`,
  `  typeof CLIENT_CSS_HREF === "string" &&`,
  `  CLIENT_CSS_HREF.indexOf(PLACEHOLDER_CSS_HREF) < 0`,
  `    ? CLIENT_CSS_HREF`,
  `    : "";`,
  `const cssLinkTag = resolvedCssHref`,
  `  ? '<link rel="stylesheet" href="' + resolvedCssHref + '">'`,
  `  : "";`,
  `export function render() {`,
  `  return cssLinkTag;`,
  `}`,
].join("\n");

describe("buildRscNitro assetsDir handling (SSR CSS href patching)", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-assetsdir-"));
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function writeFixture(
    assetsDirName: string,
    cssFileName: string,
  ): {
    rscDir: string;
    ssrDir: string;
    clientDir: string;
  } {
    const rscDir = path.join(fixtureRoot, "dist", "rsc");
    const ssrDir = path.join(fixtureRoot, "dist", "ssr");
    const clientDir = path.join(fixtureRoot, "dist", "client");
    const assetsDir = path.join(clientDir, assetsDirName);
    mkdirSync(rscDir, { recursive: true });
    mkdirSync(ssrDir, { recursive: true });
    mkdirSync(assetsDir, { recursive: true });

    writeFileSync(
      path.join(rscDir, "index.js"),
      "export default { async fetch() { return new Response('ok'); } };",
    );
    writeFileSync(path.join(ssrDir, "index.js"), SSR_FIXTURE);
    writeFileSync(path.join(assetsDir, cssFileName), "body { color: red; }");
    return { rscDir, ssrDir, clientDir };
  }

  function readPatchedSsr(): string {
    return readFileSync(
      path.join(fixtureRoot, ".output", "server", "dist", "ssr", "index.js"),
      "utf-8",
    );
  }

  it("injects the production CSS href from a custom assetsDir (_assets)", async () => {
    const cssFile = "app-abc123.css";
    const { rscDir, ssrDir, clientDir } = writeFixture("_assets", cssFile);
    expect(existsSync(path.join(clientDir, "assets"))).toBe(false);

    await buildRscNitro({
      root: fixtureRoot,
      rendererPath: path.join(rscDir, "index.js"),
      ssrPath: path.join(ssrDir, "index.js"),
      publicDir: clientDir,
      assetsDir: "_assets",
      preset: "node-server",
    });

    const patched = readPatchedSsr();
    expect(patched).toContain(`/_assets/${cssFile}`);
    expect(patched).toContain(`CLIENT_CSS_HREF = "/_assets/${cssFile}"`);
    const remainingPlaceholders = patched.split("__FARM_CLIENT_CSS_HREF__").length - 1;
    expect(remainingPlaceholders).toBe(1);
  }, 60_000);

  it("falls back to 'assets' when assetsDir is undefined (Vite default)", async () => {
    const cssFile = "app-xyz.css";
    const { rscDir, ssrDir, clientDir } = writeFixture("assets", cssFile);

    await buildRscNitro({
      root: fixtureRoot,
      rendererPath: path.join(rscDir, "index.js"),
      ssrPath: path.join(ssrDir, "index.js"),
      publicDir: clientDir,
      preset: "node-server",
    });

    const patched = readPatchedSsr();
    expect(patched).toContain(`/assets/${cssFile}`);
    expect(patched).toContain(`CLIENT_CSS_HREF = "/assets/${cssFile}"`);
  }, 60_000);

  it("leaves the CSS href empty only when the assetsDir directory is genuinely absent", async () => {
    const { rscDir, ssrDir, clientDir } = writeFixture("assets", "ignored.css");
    rmSync(path.join(clientDir, "assets"), { recursive: true, force: true });

    await buildRscNitro({
      root: fixtureRoot,
      rendererPath: path.join(rscDir, "index.js"),
      ssrPath: path.join(ssrDir, "index.js"),
      publicDir: clientDir,
      assetsDir: "_assets",
      preset: "node-server",
    });

    const patched = readPatchedSsr();
    expect(patched).toContain('CLIENT_CSS_HREF = ""');
    expect(patched).not.toContain("/_assets/");
    expect(patched).not.toContain("/assets/app-xyz.css");
  }, 60_000);
});
