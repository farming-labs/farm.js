// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer } from "./production-server";

/**
 * A route's `search.preserve` names params Farm links carry from the current URL. Links read the
 * routes from the development manifest in the browser only, so a server render never preserved
 * (development pages hydrated with a mismatched href) and production, which has no browser
 * manifest, never preserved at all.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
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

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-link-search-preserve-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom", "zod"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false };`,
    "src/app/layout.tsx": `import { Link } from "@farm.js/core/client";
import { ClientNav } from "../client-nav";
export default function Layout({ children }) {
  return <div><nav><Link id="server-link" href="/products/2">server</Link></nav><ClientNav />{children}</div>;
}`,
    "src/client-nav.tsx": `"use client";
import { Link } from "@farm.js/core/client";
export function ClientNav() {
  return <nav><Link id="client-link" href="/products/3">client</Link></nav>;
}`,
    "src/app/page.tsx": `export default function Home() { return <h1>Home</h1>; }`,
    "src/product-page.tsx": `import { Link } from "@farm.js/core/client";
export function ProductPage({ params, search }) {
  return <main><h1 id="product">{"Product " + params.id + " " + search.locale}</h1><Link id="page-link" href="/products/4">next</Link></main>;
}`,
    "src/routes.tsx": `import { defineRoutes } from "@farm.js/core";
import { z } from "zod";
import { ProductPage } from "./product-page";
export default defineRoutes(({ page }) => [
  page("/products/[id]", {
    search: { schema: z.object({ locale: z.string().default("en") }), preserve: ["locale"] },
    component: ProductPage,
  }),
]);`,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

async function expectServerRenderedHrefs(origin: string) {
  const preserved = await (await fetch(`${origin}/products/1?locale=am`)).text();
  expect(preserved).toContain('href="/products/2?locale=am"');
  expect(preserved).toContain('href="/products/3?locale=am"');
  expect(preserved).toContain('href="/products/4?locale=am"');
  // The next request has no locale: nothing carries over from the one before.
  const plain = await (await fetch(`${origin}/products/1`)).text();
  expect(plain).toContain('href="/products/2"');
  expect(plain).toContain('href="/products/3"');
  expect(plain).not.toContain("locale=am");
}

describe("search.preserve on Farm links", () => {
  it("is applied by the development server render", async () => {
    const root = await createApp();
    const server = await createServer({ root });
    await server.listen(await getAvailablePort());
    try {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Missing dev server address");
      await expectServerRenderedHrefs(`http://localhost:${address.port}`);
    } finally {
      await server.close();
    }
  }, 120_000);

  it("is applied in production, rendered and hydrated alike", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    try {
      await expectServerRenderedHrefs(server.origin);

      const executablePath = await resolveChromium();
      if (!executablePath) return;
      const browser = await chromium.launch({ executablePath });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.goto(`${server.origin}/products/1?locale=am`);
        await page.waitForFunction(() => Boolean((window as any).__FARM_SPA_ROUTER__));
        expect(await page.getAttribute("#client-link", "href")).toBe("/products/3?locale=am");

        await page.click("#client-link");
        await page.waitForFunction(
          () => document.querySelector("#product")?.textContent === "Product 3 am",
        );
        expect(new URL(page.url()).search).toBe("?locale=am");
        expect(await page.getAttribute("#page-link", "href")).toBe("/products/4?locale=am");
        expect(errors.filter((error) => /hydrat|did not match/i.test(error))).toEqual([]);
      } finally {
        await browser.close();
      }
    } finally {
      await server.stop();
    }
  }, 240_000);
});
