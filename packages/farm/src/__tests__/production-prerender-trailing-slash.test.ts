// @vitest-environment node

import { readFileSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Nitro } from "nitro/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

/**
 * With `trailingSlash`, a page answers at one spelling and redirects the other with 308, in
 * development and production. A prerendered page is a static file, and Nitro's static handler
 * strips the trailing slash and tries the file and its index.html before the request reaches
 * Farm, so a node-server build answered both spellings with 200: two URLs for one page.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];

/**
 * The workspace locks Nitro's h3 at the version Farm pins, but an app's lockfile can resolve any
 * h3 Nitro's range allows. When set, the deployed server bundles this h3 wherever Nitro's own
 * runtime imports it, as such an app's does; Farm's own modules keep the h3 Farm pins.
 */
const nitroH3 = vi.hoisted(() => ({ floor: false, resolved: 0 }));

vi.mock("nitro/builder", async (importOriginal) => {
  const builder = await importOriginal<typeof import("nitro/builder")>();
  const createNitro: typeof builder.createNitro = async (...args) => {
    const nitro = await builder.createNitro(...args);
    if (nitroH3.floor) resolveNitroH3ToFloor(nitro);
    return nitro;
  };
  return { ...builder, createNitro };
});

function resolveNitroH3ToFloor(nitro: Nitro) {
  const farmRoot = toPosix(realpathSync(packageRoot)) + "/";
  const farmManifest = path.join(packageRoot, "package.json");
  nitro.hooks.hook("rollup:before", (_nitro, config) => {
    const plugins = Array.isArray(config.plugins) ? config.plugins : [config.plugins];
    config.plugins = [
      {
        name: "test:nitro-h3",
        resolveId: {
          order: "pre",
          async handler(source, rawImporter, options) {
            const importer = rawImporter && toPosix(rawImporter);
            // Nitro's route rules run in "h3/rules", so subpaths move with the package.
            if (source !== "h3" && !source.startsWith("h3/")) return null;
            // Virtual modules are Nitro's: only a real file under Farm keeps Farm's h3.
            if (importer && path.isAbsolute(importer) && importer.startsWith(farmRoot)) {
              return null;
            }
            nitroH3.resolved++;
            const floor = `h3-nitro-floor${source.slice("h3".length)}`;
            return this.resolve(floor, farmManifest, { ...options, skipSelf: true });
          },
        },
      },
      ...plugins,
    ];
  });
}

function toPosix(file: string) {
  return file.split(path.sep).join("/");
}

/** Checks that `h3-nitro-floor`, a devDependency, is the lowest h3 Nitro's range allows. */
function expectNitroFloorH3() {
  const coreRequire = createRequire(path.join(packageRoot, "package.json"));
  const nitroManifest = JSON.parse(
    readFileSync(coreRequire.resolve("nitro/package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  const floorDir = path.dirname(coreRequire.resolve("h3-nitro-floor/package.json"));
  const floor = JSON.parse(readFileSync(path.join(floorDir, "package.json"), "utf8")) as {
    version: string;
  };
  expect(
    nitroManifest.dependencies.h3,
    "Nitro's h3 range changed: point h3-nitro-floor at its lowest version",
  ).toBe(`^${floor.version}`);
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

async function startApp(trailingSlash: boolean, nitroH3Floor = false) {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-prerender-trailing-slash-"));
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
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false, trailingSlash: ${trailingSlash} };`,
    "src/app/layout.tsx":
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
    "src/app/page.tsx": `export const dynamic = "force-static";
export default function Home() { return <main>home</main>; }`,
    "src/app/about/page.tsx": `export const dynamic = "force-static";
export default function About() { return <main>about</main>; }`,
    "src/app/blog/[slug]/page.tsx": `export const dynamic = "force-static";
export function getStaticPaths() { return [{ slug: "one" }, { slug: "a+b" }]; }
export default function Post({ params }) { return <main>{"post " + params.slug}</main>; }`,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  const config = await resolveConfig(
    { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
    "production",
  );
  nitroH3.floor = nitroH3Floor;
  nitroH3.resolved = 0;
  try {
    await build(config, { root, preset: "node-server" });
  } finally {
    nitroH3.floor = false;
  }
  if (nitroH3Floor) expect(nitroH3.resolved, "Nitro's runtime imported no h3").toBeGreaterThan(0);
  return startProductionServer(path.join(root, ".farm", ".output", "server"));
}

describe("a prerendered page in a node-server build", () => {
  it.each([
    [false, "/about", "/about/"],
    [true, "/about/", "/about"],
  ])(
    "with trailingSlash: %s answers %s and redirects %s to it",
    async (trailingSlash, canonical, other) => {
      const server = await startApp(trailingSlash);
      try {
        const page = await fetch(`${server.origin}${canonical}`, { redirect: "manual" });
        expect(page.status).toBe(200);
        expect(await page.text()).toContain("about");

        const redirected = await fetch(`${server.origin}${other}?ref=nav`, { redirect: "manual" });
        expect(redirected.status).toBe(308);
        expect(redirected.headers.get("location")).toBe(`${canonical}?ref=nav`);

        // A getStaticPaths page too, and the home page answers at "/".
        const post = trailingSlash ? "/blog/one/" : "/blog/one";
        const postOther = trailingSlash ? "/blog/one" : "/blog/one/";
        expect((await fetch(`${server.origin}${post}`, { redirect: "manual" })).status).toBe(200);
        const postRedirect = await fetch(`${server.origin}${postOther}`, { redirect: "manual" });
        expect(postRedirect.status).toBe(308);
        expect(postRedirect.headers.get("location")).toBe(post);
        const literal = post.replace("one", "a%2Bb");
        const alternate = postOther.replace("one", "a%2Bb");
        const literalPage = await fetch(`${server.origin}${literal}`, { redirect: "manual" });
        expect(literalPage.status).toBe(200);
        const literalRedirect = await fetch(`${server.origin}${alternate}?a=1&a=2`, {
          redirect: "manual",
        });
        expect(literalRedirect.status, server.output()).toBe(308);
        expect(literalRedirect.headers.get("location")).toBe(`${literal}?a=1&a=2`);
        expect((await fetch(`${server.origin}/`, { redirect: "manual" })).status).toBe(200);
      } finally {
        await server.stop();
      }
    },
    240_000,
  );
});

describe("a prerendered page on the oldest h3 Nitro allows", () => {
  // Farm once redirected the other spelling with a Nitro route rule. Nitro's router matches a rule
  // without the trailing slash, so the rule for "/about/" also matched "/about": h3 2.0.8 skips a
  // redirect to the current URL, but earlier h3 answered the canonical page with a 308 to itself.
  it.each([
    [false, "/about", "/about/"],
    [true, "/about/", "/about"],
  ])(
    "with trailingSlash: %s answers %s and redirects %s to it",
    async (trailingSlash, canonical, other) => {
      expectNitroFloorH3();
      const server = await startApp(trailingSlash, true);
      try {
        const page = await fetch(`${server.origin}${canonical}`, { redirect: "manual" });
        expect(page.status, server.output()).toBe(200);
        expect(await page.text()).toContain("about");

        const redirected = await fetch(`${server.origin}${other}`, { redirect: "manual" });
        expect(redirected.status).toBe(308);
        expect(redirected.headers.get("location")).toBe(canonical);
      } finally {
        await server.stop();
      }
    },
    240_000,
  );
});
