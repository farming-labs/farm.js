// @vitest-environment node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMMUTABLE = "public, max-age=31536000, immutable";
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
// A 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

interface FixtureOptions {
  basePath?: string;
  /** A file the app serves from public/assets, next to Vite's hashed assets. */
  publicAsset?: boolean;
  routeRules?: Record<string, unknown>;
  /** Islands mode, whose client build also emits farm-client-boot-h<hash>.js. */
  islands?: boolean;
}

async function createFixture(name: string, options: FixtureOptions): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, `.tmp-production-immutable-${name}-`));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.mkdir(path.join(root, "public", "assets"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default ${JSON.stringify({
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      ...(options.basePath ? { basePath: options.basePath } : {}),
      ...(options.routeRules ? { routeRules: options.routeRules } : {}),
      ...(options.islands ? { experimental: { serverComponents: true } } : {}),
    })};\n`,
  );
  // An image referenced from CSS becomes a hashed Vite asset under assets/.
  await fs.writeFile(path.join(root, "src", "app", "pixel.png"), PNG);
  await fs.writeFile(
    path.join(root, "src", "app", "globals.css"),
    `body { background-image: url("./pixel.png"); }\n`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `import "./globals.css";\nexport default function Layout({ children }) { return <html><body>{children}</body></html>; }\n`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "lazy.tsx"),
    `export default function Lazy() { return <span>lazy-chunk</span>; }\n`,
  );
  // The dynamic import splits a hashed chunk under chunks/.
  await fs.writeFile(
    path.join(root, "src", "app", "counter.tsx"),
    `"use client";
import { lazy, Suspense, useState } from "react";
const Lazy = lazy(() => import("./lazy"));
export default function Counter() {
  const [shown, setShown] = useState(false);
  return <div><button onClick={() => setShown(true)}>show</button>{shown ? <Suspense><Lazy /></Suspense> : null}</div>;
}
`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `import Counter from "./counter";\nexport default function Page() { return <main>immutable-assets<Counter /></main>; }\n`,
  );
  await fs.writeFile(path.join(root, "public", "favicon.ico"), PNG);
  await fs.writeFile(path.join(root, "public", "robots.txt"), "User-agent: *\n");
  if (options.publicAsset) {
    await fs.writeFile(path.join(root, "public", "assets", "logo.png"), PNG);
  }
  return root;
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(path.join(dir, entry.name), relative)));
    else files.push(relative);
  }
  return files;
}

async function buildFixture(name: string, options: FixtureOptions, preset: string) {
  const root = await createFixture(name, options);
  const userConfig = await loadConfig(root, undefined, "production");
  const config = await resolveConfig({ ...userConfig, root }, "production");
  await build(config, { root, preset });
  return root;
}

async function buildAndStart(
  name: string,
  options: FixtureOptions,
  preset: "node-server" | "bun" = "node-server",
) {
  const root = await buildFixture(name, options, preset);
  const publicDir = path.join(root, ".farm", ".output", "public");
  const files = (await listFiles(publicDir)).filter((file) => !/\.(?:gz|br)$/.test(file));
  const production = await startProductionServer(path.join(root, ".farm", ".output", "server"), {
    command: preset === "bun" ? "bun" : process.execPath,
  });
  return { root, files, production };
}

interface VercelRoute {
  handle?: string;
  src?: string;
  dest?: string;
  headers?: Record<string, string>;
  continue?: boolean;
}

/**
 * The Cache-Control Vercel's routing gives a static file: routes before the filesystem
 * handler apply their headers in order, and a match that does not continue ends the phase.
 */
function vercelStaticCacheControl(routes: VercelRoute[], pathname: string): string | null {
  let cacheControl: string | null = null;
  for (const route of routes) {
    if (route.handle === "filesystem") break;
    if (!route.src || !new RegExp(route.src).test(pathname)) continue;
    for (const [name, value] of Object.entries(route.headers ?? {})) {
      if (name.toLowerCase() === "cache-control") cacheControl = value;
    }
    if (!route.continue) break;
  }
  return cacheControl;
}

function pick(files: string[], pattern: RegExp): string {
  const file = files.find((candidate) => pattern.test(candidate));
  if (!file) throw new Error(`No output file matches ${pattern}: ${files.join(", ")}`);
  return file;
}

async function cacheControl(origin: string, pathname: string) {
  const response = await fetch(`${origin}${pathname}`);
  await response.arrayBuffer();
  return { status: response.status, cacheControl: response.headers.get("cache-control") };
}

describe("production caching of content-hashed client assets (node-server)", () => {
  // it.for, not it.each: only it.for hands the test context over, so ctx.skip() works without bun.
  it.for(["node-server", "bun"] as const)(
    "serves hashed client files immutable, gzipped, and public files revalidatable ($0)",
    async (preset, ctx) => {
      if (preset === "bun" && !hasBun) ctx.skip();
      const { root, files, production } = await buildAndStart(
        `root-${preset}`,
        { publicAsset: true },
        preset,
      );
      try {
        const html = await (await fetch(`${production.origin}/`)).text();
        const entry = pick(files, /^farm-client-h[0-9a-f]+\.js$/);
        expect(html).toContain(`/${entry}`);
        const hashed = [
          entry,
          pick(files, /^chunks\/lazy-h[0-9a-f]+\.js$/),
          pick(files, /^assets\/pixel-h[0-9a-f]+\.png$/),
          pick(files, /^assets\/farm-client-h[0-9a-f]+\.css$/),
        ];
        for (const file of hashed) {
          expect(await cacheControl(production.origin, `/${file}`), file).toEqual({
            status: 200,
            cacheControl: IMMUTABLE,
          });
        }

        // Unhashed files keep revalidating, including one beside Vite's assets.
        for (const file of [
          "favicon.ico",
          "robots.txt",
          "assets/logo.png",
          "farm-client.js",
          "farm-client.css",
        ]) {
          const result = await cacheControl(production.origin, `/${file}`);
          expect(result.status, file).toBe(200);
          expect(result.cacheControl ?? "", file).not.toContain("immutable");
        }

        // The server sends a client file's gzip copy to a browser that accepts gzip.
        const gzipped = await fetch(`${production.origin}/${entry}`, {
          headers: { "accept-encoding": "gzip" },
        });
        expect(gzipped.headers.get("content-encoding")).toBe("gzip");
        expect(await gzipped.text()).toBe(
          await fs.readFile(path.join(root, ".farm", ".output", "public", entry), "utf8"),
        );

        // A chunk an older deployment referenced is a 404 that no cache keeps.
        const missing = await cacheControl(production.origin, "/chunks/gone-h0123abcd.js");
        expect(missing.status).toBe(404);
        expect(missing.cacheControl ?? "").not.toContain("immutable");
      } finally {
        await production.stop();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it("keeps the policy below a basePath and lets an app route rule win", async () => {
    const { root, files, production } = await buildAndStart("base-path", {
      basePath: "/console",
      routeRules: { "/assets/**": { headers: { "cache-control": "public, max-age=600" } } },
      islands: true,
    });
    try {
      const html = await (await fetch(`${production.origin}/console`)).text();
      // Hashed client files are referenced at the origin root, below no basePath.
      const scriptSrc = html.match(
        /<script[^>]+src="([^"]*farm-client(?:-boot)?-h[0-9a-f]+\.js)"/,
      )?.[1];
      expect(scriptSrc).toMatch(/^\/farm-client(?:-boot)?-h[0-9a-f]+\.js$/);
      for (const file of [
        pick(files, /^farm-client-h[0-9a-f]+\.js$/),
        pick(files, /^farm-client-boot-h[0-9a-f]+\.js$/),
        pick(files, /^chunks\/lazy-h[0-9a-f]+\.js$/),
      ]) {
        expect(await cacheControl(production.origin, `/${file}`), file).toEqual({
          status: 200,
          cacheControl: IMMUTABLE,
        });
      }
      // The app's own rule for assets/ wins over Farm's default.
      const asset = pick(files, /^assets\/pixel-h[0-9a-f]+\.png$/);
      expect(await cacheControl(production.origin, `/${asset}`)).toEqual({
        status: 200,
        cacheControl: "public, max-age=600",
      });
      const favicon = await cacheControl(production.origin, "/favicon.ico");
      expect(favicon.status).toBe(200);
      expect(favicon.cacheControl ?? "").not.toContain("immutable");
    } finally {
      await production.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});

describe("production caching of content-hashed client assets (vercel)", () => {
  it("routes hashed static files to the immutable header and nothing else", async () => {
    const root = await buildFixture("vercel", { publicAsset: true, islands: true }, "vercel");
    try {
      const output = path.join(root, ".vercel", "output");
      const files = await listFiles(path.join(output, "static"));
      const { routes } = JSON.parse(await fs.readFile(path.join(output, "config.json"), "utf8"));
      for (const file of [
        pick(files, /^farm-client-h[0-9a-f]+\.js$/),
        pick(files, /^farm-client-boot-h[0-9a-f]+\.js$/),
        pick(files, /^chunks\/lazy-h[0-9a-f]+\.js$/),
        pick(files, /^assets\/pixel-h[0-9a-f]+\.png$/),
        pick(files, /^assets\/farm-client-h[0-9a-f]+\.css$/),
      ]) {
        expect(vercelStaticCacheControl(routes, `/${file}`), file).toBe(IMMUTABLE);
      }
      for (const file of ["favicon.ico", "robots.txt", "assets/logo.png", "farm-client.js"]) {
        expect(files, file).toContain(file);
        expect(vercelStaticCacheControl(routes, `/${file}`) ?? "", file).not.toContain("immutable");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
