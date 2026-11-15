// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

/**
 * Cloudflare's asset server answers a directory index (`about/index.html`) at the trailing-slash
 * URL and redirects the other spelling to it. A prerendered page is therefore written as
 * `about.html` unless `trailingSlash` asks for the slash, so it answers at its canonical URL,
 * where `_headers` applies its headers. It used to be `about/index.html` whatever the setting, so
 * `/about` redirected to `/about/`, which no `headers()` rule named.
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

async function buildStaticAbout(
  preset: "cloudflare-pages" | "cloudflare-module",
  trailingSlash: boolean,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-cloudflare-prerender-"));
  roots.push(root);
  const write = async (relativePath: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  };
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await write("package.json", '{"name":"cf-prerender","type":"module","private":true}');
  await write(
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  );
  await write(
    "src/app/about/page.tsx",
    `export const dynamic = "force-static";
export default function About() { return <main>about-page</main>; }`,
  );
  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      telemetry: false,
      images: { provider: "none" },
      trailingSlash,
      deploy: preset === "cloudflare-module" ? { preset } : { target: "cloudflare" },
      headers: () => [{ source: "/about", headers: [{ key: "x-custom", value: "about" }] }],
    } as any,
    "production",
  );
  await build(config, { root, preset });
  return path.join(root, ".farm", ".output", ...(preset === "cloudflare-module" ? ["public"] : []));
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

describe("prerendered pages on Cloudflare", () => {
  it.each(["cloudflare-pages", "cloudflare-module"] as const)(
    "%s writes about.html, which answers at /about",
    async (preset) => {
      const publicDir = await buildStaticAbout(preset, false);
      expect(await fs.readFile(path.join(publicDir, "about.html"), "utf8")).toContain("about-page");
      expect(await exists(path.join(publicDir, "about", "index.html"))).toBe(false);
    },
    240_000,
  );

  it("keeps about/index.html when trailingSlash asks for /about/", async () => {
    const publicDir = await buildStaticAbout("cloudflare-pages", true);
    expect(await fs.readFile(path.join(publicDir, "about", "index.html"), "utf8")).toContain(
      "about-page",
    );
    expect(await exists(path.join(publicDir, "about.html"))).toBe(false);
  }, 240_000);
});
