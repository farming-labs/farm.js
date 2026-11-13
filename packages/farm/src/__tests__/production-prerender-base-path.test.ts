// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { getAvailablePort } from "./dev-server-port";

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

async function buildFixture(root: string, target: "vercel" | "node-server"): Promise<void> {
  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      basePath: "/console",
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
  }, 180_000);

  it("serves the prerendered file below the basePath from a Node server", async () => {
    const root = await createFixture();
    await buildFixture(root, "node-server");
    const outputDir = path.join(root, ".farm", ".output");
    const file = await readIfExists(
      path.join(outputDir, "public", "console", "about", "index.html"),
    );
    expect(file).toContain("about-page");

    const port = await getAvailablePort();
    const server = spawn(process.execPath, [path.join(outputDir, "server", "index.mjs")], {
      cwd: path.join(outputDir, "server"),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: "ignore",
    });
    const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
    try {
      const origin = `http://127.0.0.1:${port}`;
      const fetchPage = async (pathname: string): Promise<string> => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await (await fetch(`${origin}${pathname}`)).text();
          } catch (error) {
            if (attempt >= 100 || server.exitCode !== null) throw error;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      };
      const first = await fetchPage("/console/about");
      const second = await fetchPage("/console/about");
      // The build's render, not a new one per request.
      expect(renderedAt(first)).toBe(renderedAt(file));
      expect(renderedAt(second)).toBe(renderedAt(file));
    } finally {
      // Windows refuses to remove the output while the server still holds it as its cwd.
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await exited;
      }
    }
  }, 180_000);
});
