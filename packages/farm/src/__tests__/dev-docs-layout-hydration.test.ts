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
  return { root, server, origin: `http://localhost:${address.port}` };
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

/**
 * Islands mode: a server layout wraps docs pages as it wraps an app page, as production does.
 * Around a client provider it renders as a server tree the browser rebuilds with the docs page at
 * its outlet; with only leaf client components, those hydrate as islands.
 */
describe("a docs runtime page under an islands server layout in farm dev", () => {
  const nav = `<nav>
        <a href="/" data-nav="home">Home</a>
        <a href="/about" data-nav="about">About</a>
        <a href="/docs" data-nav="docs">Docs</a>
      </nav>`;

  async function expectIslandsDocsLayout(
    files: Record<string, string>,
    options: {
      /** The docs page renders inside the layout's server tree, which the browser rebuilds. */
      serverTree?: boolean;
      expectWorks(page: Page): Promise<void>;
      expectKept(page: Page): Promise<void>;
    },
  ) {
    const executablePath = await resolveChromium();
    if (!executablePath) return;
    const { origin } = await startDocsApp(
      {
        ...files,
        "src/app/page.tsx": "export default function Page() { return <main>home page</main>; }",
        "src/app/about/page.tsx":
          "export default function Page() { return <main>about page</main>; }",
        "src/app/docs/page.md": "# Docs index\n\nThe docs index.",
        "src/app/docs/guide/page.md": "# Docs guide\n\nA nested docs page.",
      },
      {
        docs: { entry: "/docs", search: false },
        experimental: { serverComponents: { mode: "islands" } },
      },
    );

    // The layout's chrome wraps the docs runtime's page, which keeps its own document.
    const html = await (await fetch(`${origin}/docs/guide`)).text();
    expect(html).toContain('data-layout="root"');
    expect(html.indexOf('data-layout="root"')).toBeLessThan(html.indexOf('id="nd-page"'));
    expect(html.match(/<html[\s>]/gi)).toHaveLength(1);
    expect(html.includes('<script type="f/tree"')).toBe(options.serverTree === true);

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
      try {
        for (const pathname of ["/docs", "/docs/guide"]) {
          await page.goto(`${origin}${pathname}`);
          await options.expectWorks(page);
          expect(await page.locator("#nd-page").count()).toBe(1);
        }
        expect(hydrationErrors).toEqual([]);

        // The docs runtime owns its document's links: an app page loads as a document.
        await page.locator('[data-nav="about"]').click();
        await page.waitForURL(`${origin}/about`);
        await expect.poll(() => page.locator("main").textContent()).toBe("about page");
        await options.expectWorks(page);
        // Between app pages, the layout and its state stay in one document.
        documentRequests.length = 0;
        await page.locator('[data-nav="home"]').click();
        await page.waitForURL(`${origin}/`);
        await expect.poll(() => page.locator("main").textContent()).toBe("home page");
        await options.expectKept(page);
        expect(documentRequests).toEqual([]);
        expect(hydrationErrors).toEqual([]);
      } catch (error) {
        throw new Error(
          `${String(error)}\nHydration errors:\n${hydrationErrors.join("\n")}\nDocument requests: ${documentRequests.join(", ")}`,
        );
      }
    } finally {
      await browser.close();
    }
  }

  it("hydrates a docs page inside a server layout's provider tree", async () => {
    const toggle = (page: Page) => page.locator("[data-theme-toggle]");
    await expectIslandsDocsLayout(
      {
        "src/app/theme.tsx": `"use client";
import { createContext, useContext, useEffect, useState } from "react";
const ThemeContext = createContext(null);
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState("light");
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
export function ThemeToggle() {
  const context = useContext(ThemeContext);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!context) return <button data-theme-toggle data-hydrated="false">no provider</button>;
  return (
    <button
      data-theme-toggle
      data-hydrated={hydrated ? "true" : "false"}
      onClick={() => context.setTheme(context.theme === "light" ? "dark" : "light")}
    >
      theme:{context.theme}
    </button>
  );
}`,
        // A server layout around a client provider, which hydrates as one server tree.
        "src/app/layout.tsx": `import { ThemeProvider, ThemeToggle } from "./theme";
export default function RootLayout({ children }) {
  return (
    <ThemeProvider>
      <div data-layout="root">
        ${nav}
        <ThemeToggle />
        {children}
      </div>
    </ThemeProvider>
  );
}`,
      },
      {
        serverTree: true,
        async expectWorks(page) {
          await expect
            .poll(() => toggle(page).getAttribute("data-hydrated"), { timeout: 15_000 })
            .toBe("true");
          await expect.poll(() => toggle(page).textContent()).toBe("theme:light");
          await toggle(page).click();
          await expect.poll(() => toggle(page).textContent()).toBe("theme:dark");
        },
        async expectKept(page) {
          expect(await toggle(page).textContent()).toBe("theme:dark");
        },
      },
    );
  }, 120_000);

  it("wraps docs pages in a server layout with a leaf island, and hydrates it", async () => {
    const counter = (page: Page) => page.locator("[data-counter]");
    await expectIslandsDocsLayout(
      {
        // A server layout whose only client component is a leaf island: it does not hydrate whole.
        "src/app/layout.tsx": `import { Counter } from "./counter";
export default function RootLayout({ children }) {
  return (
    <div data-layout="root">
      ${nav}
      <Counter />
      {children}
    </div>
  );
}`,
      },
      {
        async expectWorks(page) {
          await expect
            .poll(() => counter(page).getAttribute("data-hydrated"), { timeout: 15_000 })
            .toBe("true");
          await counter(page).click();
          await expect.poll(() => counter(page).textContent()).toBe("count:1");
        },
        async expectKept(page) {
          expect(await counter(page).textContent()).toBe("count:1");
        },
      },
    );
  }, 120_000);
});

/**
 * Docs content under a `docs.contentDir` outside src/app is no module and no route file, so no
 * edit there reached the open page, which kept the old content until a manual reload. An edit,
 * addition or removal there now reloads open pages with the new content, as one under src/app does.
 */
describe("docs content outside src/app in farm dev", () => {
  it("reloads open docs pages on content edits, additions and removals, and not for other files", async () => {
    const executablePath = await resolveChromium();
    if (!executablePath) return;

    const { root, server, origin } = await startDocsApp(
      {
        "src/app/layout.tsx": `import { Counter } from "./counter";
export default function RootLayout({ children }) {
  return (
    <div data-layout="root">
      <Counter />
      {children}
    </div>
  );
}`,
        "src/app/page.tsx": "export default function Page() { return <main>home page</main>; }",
        "content/docs/page.md": "# Docs index\n\nThe docs index.",
        "content/docs/guide.md": "# Docs guide\n\nThe first guide.",
        // Its path starts with the content directory's, but it is outside it.
        "content/docs-drafts/draft.md": "# Draft\n\nA draft.",
      },
      {
        basePath: "/workspace",
        docs: { entry: "/docs", contentDir: "content/docs", search: false },
      },
    );
    const guidePath = path.join(root, "content/docs/guide.md");
    const addedPath = path.join(root, "content/docs/added.md");
    const draftPath = path.join(root, "content/docs-drafts/draft.md");
    // The reloads the dev server sends: two sent close together can reach the page as one.
    const reloads: unknown[] = [];
    const send = server.ws.send.bind(server.ws) as (payload: unknown) => void;
    server.ws.send = ((payload: unknown) => {
      if ((payload as { type?: string } | undefined)?.type === "full-reload") reloads.push(payload);
      send(payload);
    }) as typeof server.ws.send;

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
      const article = page.locator("#nd-page");
      const addedLink = page.locator('#nd-sidebar a[href="/workspace/docs/added"]');
      const markDocument = async () => {
        documentRequests.length = 0;
        await page.evaluate(
          () => ((window as { __farmDocument?: string }).__farmDocument = "kept"),
        );
      };
      const documentMark = () =>
        page.evaluate(() => (window as { __farmDocument?: string }).__farmDocument);
      const lastUpdated = () => article.locator("time").getAttribute("datetime");

      try {
        await page.goto(`${origin}/workspace/docs/guide`);
        await expect.poll(() => article.textContent()).toContain("The first guide.");
        await expectCounterHydrated(page);

        // An edit reloads the page with the new content and the file's new date.
        await markDocument();
        await fs.writeFile(guidePath, "# Docs guide\n\nThe edited guide.");
        await expect
          .poll(() => article.textContent(), { timeout: 15_000 })
          .toContain("The edited guide.");
        expect(await documentMark()).toBeUndefined();
        expect(documentRequests).toEqual(["/workspace/docs/guide"]);
        expect(await lastUpdated()).toBe((await fs.stat(guidePath)).mtime.toISOString());
        await expectCounterHydrated(page);

        // A new page reloads the open page, whose sidebar lists it, and is routable.
        await markDocument();
        await fs.writeFile(addedPath, "# Added page\n\nA page added while the server runs.");
        await expect.poll(() => addedLink.count(), { timeout: 15_000 }).toBe(1);
        expect(await documentMark()).toBeUndefined();
        await addedLink.click();
        await page.waitForURL(`${origin}/workspace/docs/added`);
        await expect
          .poll(() => article.textContent())
          .toContain("A page added while the server runs.");

        // Removing it reloads the open page, and its path is no docs page any more.
        await markDocument();
        await fs.rm(addedPath);
        await expect.poll(() => documentMark(), { timeout: 15_000 }).toBeUndefined();
        expect((await fetch(`${origin}/workspace/docs/added`)).status).toBe(404);
        await page.goto(`${origin}/workspace/docs/guide`);
        await expect.poll(() => article.textContent()).toContain("The edited guide.");
        expect(await addedLink.count()).toBe(0);

        // A file outside the content directory reloads nothing: when the watcher has reported
        // it, no reload went out, and a docs edit after it sends exactly one.
        await markDocument();
        reloads.length = 0;
        const draftSeen = new Promise<void>((resolve) => {
          const onChange = (file: string) => {
            // The watcher reports the root's real path, which on Windows can differ from the
            // temporary directory's short name, with either separator.
            if (!file.replace(/\\/g, "/").endsWith("/content/docs-drafts/draft.md")) return;
            server.watcher.off("change", onChange);
            resolve();
          };
          server.watcher.on("change", onChange);
        });
        await fs.writeFile(draftPath, "# Draft\n\nAn edited draft.");
        await draftSeen;
        expect(reloads).toEqual([]);
        await fs.writeFile(guidePath, "# Docs guide\n\nThe guide after the draft.");
        await expect
          .poll(() => article.textContent(), { timeout: 15_000 })
          .toContain("The guide after the draft.");
        expect(reloads).toHaveLength(1);
        expect(documentRequests).toEqual(["/workspace/docs/guide"]);
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
});
