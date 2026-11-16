// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

/**
 * A route's `search.stripDefaults` and `search.temporary` give it a canonical URL. A loaded
 * production document applies it from its bootstrap script, but a client navigation never runs
 * that script, so it kept the default and temporary params in the address bar and history, and
 * Back brought a one-time param such as `toast=saved` back. Development already wrote the
 * canonical URL.
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

/** `clientComponent` decides which production client runtime the build emits. */
async function createApp(clientComponent: boolean): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-navigation-canonical-search-"));
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
${clientComponent ? 'import { Counter } from "../counter";\n' : ""}export default function Layout({ children }) {
  return <div><nav><Link id="defaults" href="/products/1?tab=info&toast=saved#reviews">defaults</Link> <Link id="home" href="/">home</Link></nav>${clientComponent ? "<Counter />" : ""}{children}</div>;
}`,
    "src/counter.tsx": `"use client";
import { useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return <button id="counter" onClick={() => setCount(count + 1)}>{count}</button>;
}`,
    "src/app/page.tsx": `export default function Home() { return <h1 id="title">Home</h1>; }`,
    "src/product-page.tsx": `export function ProductPage({ params, search }) {
  return <h1 id="title">{"Product " + params.id + " " + search.tab + " " + (search.toast ?? "-")}</h1>;
}`,
    "src/routes.tsx": `import { defineRoutes } from "@farm.js/core";
import { z } from "zod";
import { ProductPage } from "./product-page";
export default defineRoutes(({ page }) => [
  page("/products/[id]", {
    search: {
      schema: z.object({ tab: z.enum(["info", "reviews"]).default("info"), toast: z.string().optional() }),
      stripDefaults: true,
      temporary: ["toast"],
    },
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

describe("production client navigation to a route with a canonical URL", () => {
  it.each([
    ["without client components", false],
    ["with a client component", true],
  ])(
    "writes the canonical URL to history %s",
    async (_label, clientComponent) => {
      const executablePath = await resolveChromium();
      if (!executablePath) return;
      const root = await createApp(clientComponent);
      const config = await resolveConfig(
        { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
      const browser = await chromium.launch({ executablePath });
      try {
        const page = await browser.newPage();
        await page.goto(`${server.origin}/`);
        await page.waitForFunction(() => Boolean((window as any).__FARM_SPA_ROUTER__));
        // A full page load would clear this: the checks below hold for a client navigation.
        await page.evaluate(() => ((window as any).__farmSameDocument = true));

        await page.click("#defaults");
        await page.waitForFunction(
          () => document.querySelector("#title")?.textContent === "Product 1 info saved",
        );
        await page.waitForFunction(() => location.search === "");
        expect(new URL(page.url()).pathname).toBe("/products/1");
        expect(new URL(page.url()).hash).toBe("#reviews");
        expect(await page.evaluate(() => (window as any).__farmSameDocument)).toBe(true);

        await page.click("#home");
        await page.waitForFunction(() => document.querySelector("#title")?.textContent === "Home");
        await page.goBack();
        await page.waitForFunction(() => location.pathname === "/products/1");
        // The entry Back returns to is the canonical one, without the one-time toast.
        expect(new URL(page.url()).search).toBe("");
      } finally {
        await browser.close();
        await server.stop();
      }
    },
    240_000,
  );
});
