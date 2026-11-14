// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import {
  buildFarmVercelRoutes,
  createFarmVercelCanonicalSlashRoutes,
} from "../nitro/vercel-assets";
import { startProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

/** An app mounted at /console with a static home page and a static /about page. */
async function createFixture(): Promise<string> {
  // Inside the package so the pages resolve React through the workspace.
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-prerender-base-path-"));
  temporaryRoots.push(root);
  const write = async (relativePath: string, source: string) => {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, source);
  };
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await write("package.json", '{"private":true,"type":"module"}');
  await write(
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  );
  await write(
    "src/app/page.tsx",
    `export const ssg = true;
export default function Home() { return <main data-rendered-at={Date.now()}>home-page</main>; }`,
  );
  await write(
    "src/app/about/page.tsx",
    `export const ssg = true;
export default function About() { return <main data-rendered-at={Date.now()}>about-page</main>; }`,
  );
  return root;
}

async function buildFixture(
  root: string,
  target: "vercel" | "node-server",
  options: { basePath?: string; trailingSlash?: boolean } = {},
): Promise<void> {
  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      basePath: options.basePath ?? "/console",
      trailingSlash: options.trailingSlash,
      images: { provider: "none" },
      telemetry: false,
      deploy: { target },
    },
    "production",
  );
  await build(config, { root, preset: config.deploy.preset });
}

async function readIfExists(filePath: string): Promise<string | null> {
  return fs.readFile(filePath, "utf8").catch(() => null);
}

/** Starts the built Node server, hands over a fetch for its pages, and waits for it to exit. */
async function withServer(
  outputDir: string,
  use: (fetchPage: (pathname: string) => Promise<Response>) => Promise<void>,
): Promise<void> {
  const server = await startProductionServer(path.join(outputDir, "server"));
  try {
    await use((pathname) => fetch(`${server.origin}${pathname}`, { redirect: "manual" }));
  } finally {
    // Windows refuses to remove the output while the server still holds it as its cwd.
    await server.stop();
  }
}

/**
 * Vercel sends the page's other trailing-slash spelling to Farm's function ahead of its static
 * files, and the function answers it with a 308 to the configured spelling, keeping the query.
 */
async function expectOtherSpellingRedirects(
  outputDir: string,
  routes: Array<{ src?: string; dest?: string; handle?: string }>,
  canonical: string,
  other: string,
): Promise<void> {
  const filesystemIndex = routes.findIndex((route) => route.handle === "filesystem");
  const toServer = routes.findIndex(
    (route) => route.dest === "/__nitro" && route.src && new RegExp(route.src).test(other),
  );
  expect(toServer).toBeGreaterThanOrEqual(0);
  expect(toServer).toBeLessThan(filesystemIndex);
  expect(new RegExp(routes[toServer]!.src!).test(canonical)).toBe(false);

  const { default: handler } = await import(
    /* @vite-ignore */ pathToFileURL(path.join(outputDir, "functions", "__nitro.func", "index.mjs"))
      .href
  );
  const response: Response = await handler.fetch(new Request(`https://farm.test${other}?tab=1`));
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(`${canonical}?tab=1`);
}

const renderedAt = (html: string | null) => html?.match(/data-rendered-at="(\d+)"/)?.[1];

describe("prerendering beneath a basePath", () => {
  it("writes Vercel's static files at the URLs visitors request", async () => {
    const root = await createFixture();
    await buildFixture(root, "vercel");
    const outputDir = path.join(root, ".vercel", "output");

    expect(
      await readIfExists(path.join(outputDir, "static", "console", "about", "index.html")),
    ).toContain("about-page");
    expect(await readIfExists(path.join(outputDir, "static", "console", "index.html"))).toContain(
      "home-page",
    );
    // Not at the bare app path, where a request below the basePath never finds it.
    expect(await readIfExists(path.join(outputDir, "static", "about", "index.html"))).toBeNull();

    const { routes } = JSON.parse(await fs.readFile(path.join(outputDir, "config.json"), "utf8"));
    const aboutHeaders = routes.find(
      (route: { src?: string; headers?: Record<string, string> }) =>
        route.headers && route.src && new RegExp(route.src).test("/console/about"),
    )?.headers;
    expect(aboutHeaders?.["cache-control"]).toBe("public, max-age=0, must-revalidate");
    // The Markdown alternate stays below the basePath, as on a dynamic page.
    expect(aboutHeaders?.Link).toBe('</console/about.md>; rel="alternate"; type="text/markdown"');
    await expectOtherSpellingRedirects(outputDir, routes, "/console/about", "/console/about/");
    await expectOtherSpellingRedirects(outputDir, routes, "/console", "/console/");
  }, 180_000);

  it("serves the prerendered file below the basePath from a Node server", async () => {
    const root = await createFixture();
    await buildFixture(root, "node-server");
    const outputDir = path.join(root, ".farm", ".output");
    const file = await readIfExists(
      path.join(outputDir, "public", "console", "about", "index.html"),
    );
    expect(file).toContain("about-page");

    await withServer(outputDir, async (fetchPage) => {
      const first = await fetchPage("/console/about");
      const second = await fetchPage("/console/about");
      // The build's render, not a new one per request.
      expect(renderedAt(await first.text())).toBe(renderedAt(file));
      expect(renderedAt(await second.text())).toBe(renderedAt(file));
    });
  }, 180_000);
});

describe("prerendering with trailingSlash: true", () => {
  for (const basePath of ["/", "/console"]) {
    const prefix = basePath === "/" ? "" : basePath;

    it(`serves the prerendered page at its trailing-slash URL (basePath ${basePath})`, async () => {
      const root = await createFixture();
      await buildFixture(root, "node-server", { basePath, trailingSlash: true });
      const publicDir = path.join(root, ".farm", ".output", "public");
      const about = await readIfExists(
        path.join(publicDir, ...prefix.split("/").filter(Boolean), "about", "index.html"),
      );
      expect(about).toContain("about-page");
      const home = await readIfExists(
        path.join(publicDir, ...prefix.split("/").filter(Boolean), "index.html"),
      );
      expect(home).toContain("home-page");
      // Not the 308 Farm answers the other spelling with, saved as an empty page.
      expect(
        await readIfExists(path.join(publicDir, ...`${prefix}/about`.split("/").filter(Boolean))),
      ).toBeNull();

      await withServer(path.join(root, ".farm", ".output"), async (fetchPage) => {
        const page = await fetchPage(`${prefix}/about/`);
        expect(page.status).toBe(200);
        expect(page.headers.get("content-type")).toContain("text/html");
        expect(renderedAt(await page.text())).toBe(renderedAt(about));

        // The other spelling gets the page too, not the empty body that used to be saved for it.
        // (The static server answers both spellings of a page's directory, as it does when
        // trailingSlash is false; a canonical redirect for static pages is a separate change.)
        const otherSpelling = await fetchPage(`${prefix}/about`);
        expect([200, 308]).toContain(otherSpelling.status);
        if (otherSpelling.status === 200) {
          expect(renderedAt(await otherSpelling.text())).toBe(renderedAt(about));
        } else {
          expect(otherSpelling.headers.get("location")).toBe(`${prefix}/about/`);
        }
      });
    }, 180_000);
  }

  it("writes Vercel's static file and headers for the trailing-slash URL", async () => {
    const root = await createFixture();
    await buildFixture(root, "vercel", { trailingSlash: true });
    const outputDir = path.join(root, ".vercel", "output");

    expect(
      await readIfExists(path.join(outputDir, "static", "console", "about", "index.html")),
    ).toContain("about-page");
    expect(await readIfExists(path.join(outputDir, "static", "console", "about"))).toBeNull();

    const vercelConfig = JSON.parse(await fs.readFile(path.join(outputDir, "config.json"), "utf8"));
    // No page is recorded as an empty text/plain file.
    expect(JSON.stringify(vercelConfig.overrides ?? {})).not.toContain("text/plain");
    const aboutHeaders = vercelConfig.routes.find(
      (route: { src?: string; headers?: Record<string, string> }) =>
        route.headers && route.src && new RegExp(route.src).test("/console/about/"),
    )?.headers;
    expect(aboutHeaders?.["cache-control"]).toBe("public, max-age=0, must-revalidate");
    await expectOtherSpellingRedirects(
      outputDir,
      vercelConfig.routes,
      "/console/about/",
      "/console/about",
    );
  }, 180_000);
});

describe("Vercel routes for a prerendered page's other trailing-slash spelling", () => {
  it("sends only the spelling trailingSlash does not choose to the server", () => {
    const [route] = createFarmVercelCanonicalSlashRoutes(["/", "/about", "/console", "/a.b"]);
    const matches = (pathname: string) => new RegExp(route!.src!).test(pathname);
    expect(route!.dest).toBe("/__nitro");
    for (const pathname of ["/about/", "/console/", "/a.b/"]) expect(matches(pathname)).toBe(true);
    for (const pathname of ["/about", "/console", "/", "/a.b", "/axb/", "/about/x"]) {
      expect(matches(pathname), pathname).toBe(false);
    }

    const [slashRoute] = createFarmVercelCanonicalSlashRoutes(["/", "/about/"]);
    expect(new RegExp(slashRoute!.src!).test("/about")).toBe(true);
    expect(new RegExp(slashRoute!.src!).test("/about/")).toBe(false);
    expect(createFarmVercelCanonicalSlashRoutes(["/"])).toEqual([]);
  });

  it("runs after routing middleware and before Vercel serves static files", () => {
    const middleware = { src: "^/docs$", middlewarePath: "_farm_middleware", continue: true };
    const [canonical] = createFarmVercelCanonicalSlashRoutes(["/docs"]);
    const routes = buildFarmVercelRoutes({
      presetRoutes: [{ handle: "filesystem" }],
      runtimeRoutes: [],
      middlewareRoutes: [middleware],
      canonicalSlashRoutes: [canonical!],
    });
    expect(routes.indexOf(middleware)).toBeLessThan(routes.indexOf(canonical!));
    expect(routes.indexOf(canonical!)).toBeLessThan(
      routes.findIndex((route) => route.handle === "filesystem"),
    );
  });
});
