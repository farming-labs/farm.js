// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { extractFarmFullDocument, markFarmDocumentLayouts } from "../server/full-document";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

/**
 * A root layout that renders `<html><body>` has no layout boundary element on the page, so dev
 * client navigation did not know the layout was already there: it swapped the page region for a
 * second copy of the whole layout, and every header or nav in it doubled. The document now names
 * such layouts, so navigation keeps them and swaps only the page.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

/** Runs where Chromium is installed; CI's FARM_REQUIRE_TEST_BROWSER=1 makes a missing one fail. */
async function resolveChromium(): Promise<string | null> {
  const configured = process.env.FARM_TEST_CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;
  try {
    const executablePath = chromium.executablePath();
    await fs.access(executablePath);
    return executablePath;
  } catch (error) {
    if (process.env.FARM_REQUIRE_TEST_BROWSER === "1") throw error;
    return null;
  }
}

describe("a root layout that renders the document", () => {
  it("is named on the document it renders", () => {
    const markup =
      '<div style="display:contents"><div data-farm-layout-boundary="true" data-farm-layout-pattern="/" style="display:contents"><html lang="en"><body><main>page</main></body></html></div></div>';
    expect(extractFarmFullDocument(markFarmDocumentLayouts(markup))).toBe(
      `<html data-farm-document-layouts='["/"]' lang="en"><body><main>page</main></body></html>`,
    );
    // A layout that renders a fragment is left alone.
    const fragment =
      '<div data-farm-layout-boundary="true" data-farm-layout-pattern="/" style="display:contents"><main>page</main></div>';
    expect(markFarmDocumentLayouts(fragment)).toBe(fragment);
  });

  it("stays a single copy across dev client navigations", async () => {
    const executablePath = await resolveChromium();
    if (!executablePath) return;

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-document-layout-"));
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
    for (const name of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", name)),
        path.join(root, "node_modules", name),
        "junction",
      );
    }
    const files: Record<string, string> = {
      "package.json": '{"type":"module","private":true}',
      "src/app/layout.tsx": `import { Link } from "@farm.js/core/client";
export default function RootLayout({ children }) {
  return <html lang="en"><body><nav><Link id="home" href="/">Home</Link> <Link id="about" href="/about">About</Link></nav><main>{children}</main></body></html>;
}`,
      "src/app/page.tsx": "export default function Home() { return <h1>Home</h1>; }",
      "src/app/about/page.tsx": "export default function About() { return <h1>About</h1>; }",
    };
    for (const [relativePath, source] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
      await fs.writeFile(path.join(root, relativePath), source);
    }
    const server = await createServer({ root, images: { provider: "none" }, telemetry: false });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    const browser = await chromium.launch({ executablePath });
    try {
      const page = await browser.newPage();
      const navCount = () => page.locator("nav").count();
      await page.goto(`http://localhost:${address.port}/`);
      await page.waitForFunction(() => Boolean((window as any).__FARM_SPA_ROUTER__));
      expect(await navCount()).toBe(1);
      // A full page load would clear this: the checks below hold for client navigations.
      await page.evaluate(() => ((window as any).__farmSameDocument = true));

      await page.click("#about");
      await page.waitForFunction(() => document.querySelector("h1")?.textContent === "About");
      expect(page.url()).toMatch(/\/about$/);
      expect(await navCount()).toBe(1);

      await page.click("#home");
      await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Home");
      expect(await navCount()).toBe(1);
      expect(await page.locator("h1").count()).toBe(1);
      expect(await page.evaluate(() => (window as any).__farmSameDocument)).toBe(true);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
