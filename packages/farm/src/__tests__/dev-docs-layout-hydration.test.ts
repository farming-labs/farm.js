// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

/**
 * A built-in docs runtime page (`docs.entry`, no adapter) under a layout that hydrates. `farm dev`
 * sent it without a client entry, so the layout's client components never hydrated there, though
 * they did in production. The page now renders in the tree an app page has, as production renders
 * it (docs-layout-tree.ts), with the client and boot data an app page gets.
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

/** The hydration mismatches React reports on a page; after one it renders the tree again. */
function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = [];
  const record = (message: string) => {
    if (/hydrat|react error #4(1[89]|2[0-5])\b/i.test(message)) errors.push(message);
  };
  page.on("pageerror", (error) => record(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  return errors;
}

const COUNTER = `"use client";
import { useEffect, useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <button data-counter data-hydrated={hydrated ? "true" : "false"} onClick={() => setCount(count + 1)}>
      count:{count}
    </button>
  );
}`;

async function startDocsApp(files: Record<string, string>, config: Record<string, unknown>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-docs-layout-"));
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
  for (const [relativePath, source] of Object.entries({
    "package.json": '{"type":"module","private":true}',
    "src/app/counter.tsx": COUNTER,
    ...files,
  })) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  const server = await createServer({
    root,
    images: { provider: "none" },
    telemetry: false,
    ...config,
  });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return { root, origin: `http://localhost:${address.port}` };
}

async function expectCounterHydrated(page: Page, clicks = 1) {
  const counter = page.locator("[data-counter]");
  await expect.poll(() => counter.getAttribute("data-hydrated"), { timeout: 15_000 }).toBe("true");
  const start = Number((await counter.textContent())?.replace("count:", ""));
  for (let click = 0; click < clicks; click++) await counter.click();
  await expect.poll(() => counter.textContent()).toBe(`count:${start + clicks}`);
}

describe("a docs runtime page under a hydrating layout in farm dev", () => {
  it("hydrates the layout, keeps docs paths document navigations, and reloads on edits", async () => {
    const executablePath = await resolveChromium();
    if (!executablePath) return;

    const layout = (label: string) => `import { Counter } from "./counter";
export default function RootLayout({ children }) {
  return (
    <div data-layout="root">
      <nav data-label="${label}">
        <a href="/" data-nav="home">Home</a>
        <a href="/about" data-nav="about">About</a>
        <a href="/docs" data-nav="docs">Docs</a>
      </nav>
      <Counter />
      {children}
    </div>
  );
}`;
    const { root, origin } = await startDocsApp(
      {
        "src/app/layout.tsx": layout("first"),
        "src/app/page.tsx": "export default function Page() { return <main>home page</main>; }",
        "src/app/about/page.tsx":
          "export default function Page() { return <main>about page</main>; }",
        // The docs runtime's content, as the docs show it: src/app/docs is also the route tree.
        "src/app/docs/page.md": "# Docs index\n\nThe docs index.",
        "src/app/docs/guide/page.md": "# Docs guide\n\nA nested docs page.",
      },
      { docs: { entry: "/docs", search: false } },
    );

    // The tree an app page has, as production renders it, and the client an app page loads.
    const html = await (await fetch(`${origin}/docs`)).text();
    expect(html).toContain(
      '<div id="root"><div data-farm-layout-boundary="true" data-farm-layout-pattern="/" style="display:contents"><div data-layout="root">',
    );
    expect(html).toContain(
      '<div id="__farm_page__" data-farm-segment="page" data-farm-client="false" data-farm-layout-client="true"',
    );
    expect(html).toContain('<script type="module" src="/@vite/client"></script>');
    expect(html).toContain('<script type="module" src="/@farm/client.js"></script>');
    expect(html).toContain('id="nd-docs-layout"');

    const browser = await chromium.launch({ executablePath });
    try {
      const page = await browser.newPage();
      const hydrationErrors = collectHydrationErrors(page);
      const documentRequests: string[] = [];
      page.on("request", (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          documentRequests.push(new URL(request.url()).pathname);
        }
      });
      const counter = page.locator("[data-counter]");
      const markDocument = () =>
        page.evaluate(() => ((window as { __farmDocument?: string }).__farmDocument = "kept"));
      const documentMark = () =>
        page.evaluate(() => (window as { __farmDocument?: string }).__farmDocument);

      try {
        await page.goto(`${origin}/docs`);
        await expect
          .poll(() => page.locator("#nd-page").textContent())
          .toContain("The docs index.");
        await expectCounterHydrated(page);
        expect(hydrationErrors).toEqual([]);

        // The docs runtime owns its document's links: an app page loads as a document.
        await page.locator('[data-nav="about"]').click();
        await page.waitForURL(`${origin}/about`);
        await expect.poll(() => page.locator("main").textContent()).toBe("about page");
        await expectCounterHydrated(page);

        // Between app pages the client navigates in the same document; the layout keeps its state.
        await markDocument();
        documentRequests.length = 0;
        await page.locator('[data-nav="home"]').click();
        await page.waitForURL(`${origin}/`);
        await expect.poll(() => page.locator("main").textContent()).toBe("home page");
        await expect.poll(() => counter.textContent()).toBe("count:1");
        expect(await documentMark()).toBe("kept");
        expect(documentRequests).toEqual([]);

        // A docs path from an app page is a document navigation, as in production.
        await page.locator('[data-nav="docs"]').click();
        await page.waitForURL(`${origin}/docs`);
        await expect
          .poll(() => page.locator("#nd-page").textContent())
          .toContain("The docs index.");
        expect(documentRequests).toEqual(["/docs"]);
        expect(await documentMark()).toBeUndefined();
        await expectCounterHydrated(page);

        // Back from the docs document to an app page, and forward to the docs page again.
        await page.goBack();
        await page.waitForURL(`${origin}/`);
        await expect.poll(() => page.locator("main").textContent()).toBe("home page");
        await page.goForward();
        await page.waitForURL(`${origin}/docs`);
        await expect
          .poll(() => page.locator("#nd-page").textContent())
          .toContain("The docs index.");
        await expectCounterHydrated(page);
        expect(hydrationErrors).toEqual([]);

        // The docs page keeps the dev server's updates: a layout edit and a docs edit reach it.
        await fs.writeFile(path.join(root, "src/app/layout.tsx"), layout("second"));
        await expect
          .poll(() => page.locator("nav[data-label]").getAttribute("data-label"), {
            timeout: 15_000,
          })
          .toBe("second");
        await expectCounterHydrated(page);
        await fs.writeFile(
          path.join(root, "src/app/docs/page.md"),
          "# Docs index\n\nThe edited docs index.",
        );
        await expect
          .poll(() => page.locator("#nd-page").textContent(), { timeout: 15_000 })
          .toContain("The edited docs index.");
        await expectCounterHydrated(page);
        expect(hydrationErrors).toEqual([]);
      } catch (error) {
        throw new Error(
          `${String(error)}\nHydration errors:\n${hydrationErrors.join("\n")}\nDocument requests: ${documentRequests.join(", ")}`,
        );
      }
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("hydrates under a root layout that renders the document, with docs outside src/app and a base path", async () => {
    const executablePath = await resolveChromium();
    if (!executablePath) return;

    const { origin } = await startDocsApp(
      {
        "src/app/layout.tsx": `import { Counter } from "./counter";
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div data-layout="root">
          <Counter />
          {children}
        </div>
      </body>
    </html>
  );
}`,
        "src/app/page.tsx": "export default function Page() { return <main>home page</main>; }",
        // Docs content outside the app's route tree: no app page shares its paths.
        "content/docs/page.md": "# Docs index\n\nThe docs index.",
        "content/docs/guide/page.md": "# Docs guide\n\nA nested docs page.",
      },
      {
        basePath: "/workspace",
        docs: { entry: "/docs", contentDir: "content/docs", search: false },
      },
    );

    // The layout's body opens #root, as on an app page; the docs runtime keeps its document.
    const html = await (await fetch(`${origin}/workspace/docs/guide`)).text();
    expect(html).toContain('<div id="root"><div data-layout="root">');
    expect(html.match(/<html[\s>]/gi)).toHaveLength(1);
    expect(html).toContain(
      '<div id="__farm_page__" data-farm-segment="page" data-farm-client="false"',
    );

    const browser = await chromium.launch({ executablePath });
    try {
      const page = await browser.newPage();
      const hydrationErrors = collectHydrationErrors(page);
      try {
        await page.goto(`${origin}/workspace/docs/guide`);
        await expect
          .poll(() => page.locator("#nd-page").textContent())
          .toContain("A nested docs page.");
        await expectCounterHydrated(page);
        expect(hydrationErrors).toEqual([]);

        await page.goto(`${origin}/workspace/docs`);
        await expect
          .poll(() => page.locator("#nd-page").textContent())
          .toContain("The docs index.");
        await expectCounterHydrated(page, 2);
        expect(hydrationErrors).toEqual([]);
      } catch (error) {
        throw new Error(`${String(error)}\nHydration errors:\n${hydrationErrors.join("\n")}`);
      }
    } finally {
      await browser.close();
    }
  }, 120_000);
});
