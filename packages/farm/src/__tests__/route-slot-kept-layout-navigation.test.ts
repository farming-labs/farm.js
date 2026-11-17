// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer } from "./production-server";

/**
 * A slot (`@name` folder) renders for the URL, so a full load of /feed/other shows
 * `@activity/other/page.tsx` and one of /feed/third shows `@activity/default.tsx`. A client
 * navigation between pages of the same layout keeps that layout, and both runtimes kept its slot
 * containers too: the slot went on showing what the first page rendered. Development's
 * navigation fragment did not even render the kept layout's slots.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];
const devServers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...devServers].map((server) => server.close()));
  devServers.clear();
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

const link = (id: string, href: string) => `<Link id="${id}" href="${href}">${id}</Link>`;

async function createApp(): Promise<string> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(packageRoot, ".tmp-route-slot-kept-layout-")),
  );
  roots.push(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const page = (name: string) => `import { Link } from "@farm.js/core/client";
export default function Page() {
  return <main><h1>${name}</h1>${link("to-feed", "/feed")} ${link("to-other", "/feed/other")} ${link("to-third", "/feed/third")}</main>;
}`;
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false };`,
    "src/app/layout.tsx":
      "export default function Root({ children }) { return <html><body>{children}</body></html>; }",
    "src/app/feed/layout.tsx": `export default function Feed({ children, activity }) {
  return <div><section>{children}</section><aside id="activity">{activity}</aside></div>;
}`,
    "src/app/feed/page.tsx": page("feed"),
    "src/app/feed/other/page.tsx": page("other"),
    "src/app/feed/third/page.tsx": page("third"),
    "src/app/feed/@activity/page.tsx":
      "export default function Activity() { return <p>activity for feed</p>; }",
    "src/app/feed/@activity/default.tsx":
      "export default function Activity() { return <p>default activity</p>; }",
    "src/app/feed/@activity/other/page.tsx": `"use client";
import { useState } from "react";
export default function Activity() {
  const [count, setCount] = useState(0);
  return <button id="activity-button" onClick={() => setCount(count + 1)}>{"activity for other " + count}</button>;
}`,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

async function expectSlotsFollowNavigation(page: Page, origin: string): Promise<void> {
  const activity = () => page.locator("#activity").textContent();
  await page.goto(`${origin}/feed`);
  await page.waitForFunction(() => Boolean((window as any).__FARM_SPA_ROUTER__));
  expect(await activity()).toBe("activity for feed");
  // A full page load would clear this: the checks below hold for client navigations.
  await page.evaluate(() => ((window as any).__farmSameDocument = true));

  await page.click("#to-other");
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "other");
  await page.waitForFunction(
    () => document.querySelector("#activity")?.textContent === "activity for other 0",
  );
  // The client slot hydrated in the container the navigation placed.
  await page.click("#activity-button");
  await page.waitForFunction(
    () => document.querySelector("#activity")?.textContent === "activity for other 1",
  );

  await page.click("#to-third");
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "third");
  expect(await activity()).toBe("default activity");

  await page.click("#to-feed");
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "feed");
  expect(await activity()).toBe("activity for feed");
  expect(await page.evaluate(() => (window as any).__farmSameDocument)).toBe(true);
}

describe("a kept layout's slots on client navigation", () => {
  it("render for the new URL in development", async () => {
    const executablePath = await resolveChromium();
    if (!executablePath) return;
    const server = await createServer({ root: await createApp() });
    devServers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const browser = await chromium.launch({ executablePath });
    try {
      await expectSlotsFollowNavigation(
        await browser.newPage(),
        `http://localhost:${address.port}`,
      );
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("render for the new URL in production", async () => {
    const executablePath = await resolveChromium();
    if (!executablePath) return;
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    const browser = await chromium.launch({ executablePath });
    try {
      await expectSlotsFollowNavigation(await browser.newPage(), server.origin);
    } finally {
      await browser.close();
      await server.stop();
    }
  }, 240_000);
});
